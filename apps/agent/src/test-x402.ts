#!/usr/bin/env node
/**
 * x402 end-to-end test harness (fake agent).
 *
 * Drives the full pay-per-block flow against a running Skimflow server and
 * ASSERTS spec-compliance at each step, printing PASS/FAIL with a non-zero exit
 * on failure (so it works in CI and from the terminal):
 *
 *   1. GET block 0            → expect 200 + non-empty free onboarding
 *   2. GET block 1 (unpaid)   → expect 402 + a well-formed x402 v2 body:
 *                               x402Version === 2, accepts[0] with
 *                               scheme/network/asset/amount/payTo/extra.verifyingContract
 *   3. Sign EIP-3009 + retry  → expect 200 + unlocked content + X-Payment-Response
 *
 * Usage:
 *   npm run test:x402 -- --url http://localhost:3000 --slug my-skill-abc12 [--simulate]
 *   (live needs BUYER_PRIVATE_KEY for a funded Arc wallet; default is simulate)
 */
import { loadArcConfig, type Address, type Hex } from "@skimflow/sdk";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

interface AcceptQuote {
  scheme?: string;
  network: string;
  asset: Address;
  amount: string;
  payTo: Address;
  maxTimeoutSeconds?: number;
  extra?: { verifyingContract?: Address; name?: string; version?: string };
}

function agentUrl(baseUrl: string, slug: string, block?: number): string {
  const u = `${baseUrl.replace(/\/$/, "")}/read/${slug}/agent-skills.md`;
  return block === undefined ? u : `${u}?block=${block}`;
}

/** Sign the EIP-3009 authorization (empty sig in simulate) → base64 X-Payment. */
async function buildXPayment(accept: AcceptQuote, simulate: boolean, chainId: number): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const now = Math.floor(Date.now() / 1000);
  const validBefore = String(now + Math.max(Number(accept.maxTimeoutSeconds ?? 600), 7 * 24 * 3600 + 100));

  let from: Address = (process.env.BUYER_ADDRESS ??
    process.env.AGENT_WALLET_ADDRESS ??
    "0x000000000000000000000000000000000000A9E7") as Address;
  let signature: Hex | "0x" = "0x";

  if (!simulate) {
    const pk = (process.env.BUYER_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY) as Hex | undefined;
    if (!pk) throw new Error("Live mode needs BUYER_PRIVATE_KEY (a funded Arc wallet).");
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(pk);
    from = account.address;
    signature = await account.signTypedData({
      domain: {
        name: accept.extra?.name ?? "GatewayWalletBatched",
        version: accept.extra?.version ?? "1",
        chainId,
        verifyingContract: (accept.extra?.verifyingContract ?? accept.asset) as Address,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from,
        to: accept.payTo,
        value: BigInt(accept.amount),
        validAfter: 0n,
        validBefore: BigInt(validBefore),
        nonce,
      },
    });
  }

  const payload = {
    x402Version: 2,
    scheme: accept.scheme ?? "exact",
    network: accept.network,
    payload: {
      authorization: { from, to: accept.payTo, value: accept.amount, validAfter: "0", validBefore, nonce },
      signature,
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

async function main() {
  const baseUrl = flag("url") ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const slug = flag("slug");
  const simulate = has("simulate") || (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";
  const chainId = loadArcConfig().chainId;

  if (!slug) {
    console.error("Usage: npm run test:x402 -- --url <baseUrl> --slug <agent-skills-slug> [--simulate]");
    process.exit(2);
  }

  console.log(`\n🧪 x402 end-to-end test`);
  console.log(`   server: ${baseUrl}`);
  console.log(`   slug:   ${slug}`);
  console.log(`   mode:   ${simulate ? "simulate" : "live"}\n`);

  // ── Step 1: free block 0 ──────────────────────────────────────────────────
  console.log("Step 1 — GET block 0 (free onboarding)");
  const b0 = await fetch(agentUrl(baseUrl, slug, 0));
  check("block 0 returns 200", b0.status === 200, `got ${b0.status}`);
  const block0 = await b0.text();
  check("block 0 is non-empty", block0.trim().length > 0);

  // ── Step 2: unpaid 402 + spec-compliance ──────────────────────────────────
  console.log("\nStep 2 — GET block 1 unpaid (expect 402 + valid x402 v2 quote)");
  const unpaid = await fetch(agentUrl(baseUrl, slug, 1));
  check("unpaid block 1 returns 402", unpaid.status === 402, `got ${unpaid.status}`);
  if (unpaid.status !== 402) {
    return finish(); // can't continue meaningfully
  }
  const body = (await unpaid.json()) as {
    x402Version?: number;
    error?: string;
    resource?: { url?: string; description?: string; mimeType?: string };
    accepts?: AcceptQuote[];
    cost_per_block?: string;
  };
  check("x402Version === 2", body.x402Version === 2, `got ${body.x402Version}`);
  check("error string present", typeof body.error === "string" && body.error.length > 0);
  check("v2 resource object present", !!body.resource?.url, "missing resource.url");
  const accept = body.accepts?.[0];
  check("accepts[0] present", !!accept);
  if (accept) {
    check("accepts[0].scheme === 'exact'", accept.scheme === "exact", `got ${accept.scheme}`);
    check("accepts[0].network is CAIP-2 (eip155:…)", /^eip155:\d+$/.test(accept.network), `got ${accept.network}`);
    check("accepts[0].amount is base units (digits)", /^\d+$/.test(String(accept.amount)), `got ${accept.amount}`);
    check("accepts[0].asset is an address", /^0x[0-9a-fA-F]{40}$/.test(accept.asset));
    check("accepts[0].payTo is an address", /^0x[0-9a-fA-F]{40}$/.test(accept.payTo));
    check("accepts[0].extra.verifyingContract present", !!accept.extra?.verifyingContract);
    check(
      "extra.name === 'GatewayWalletBatched'",
      accept.extra?.name === "GatewayWalletBatched",
      `got ${accept.extra?.name}`
    );
  }
  if (!accept) return finish();

  // ── Step 3: sign + retry ──────────────────────────────────────────────────
  console.log("\nStep 3 — sign EIP-3009 + retry with X-Payment");
  const xPayment = await buildXPayment(accept, simulate, chainId);
  const paid = await fetch(agentUrl(baseUrl, slug, 1), { headers: { "X-Payment": xPayment } });
  check("paid block 1 returns 200", paid.status === 200, `got ${paid.status}: ${(await safeText(paid.clone()))}`);
  const content = await paid.text();
  check("unlocked content is non-empty", content.trim().length > 0);
  const receipt = paid.headers.get("x-payment-response");
  check("X-Payment-Response header present", !!receipt);
  if (receipt) {
    try {
      const decoded = JSON.parse(Buffer.from(receipt, "base64").toString("utf8")) as { success?: boolean };
      check("receipt decodes + success === true", decoded.success === true);
    } catch {
      check("receipt decodes as base64 JSON", false);
    }
  }

  finish();
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 200);
  } catch {
    return "";
  }
}

function finish(): never {
  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 test harness error:", e?.message ?? e);
  process.exit(2);
});
