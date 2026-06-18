/**
 * Headless Phase 2b live settlement test — exercises the REAL relayer code
 * (submitBurnIntent → gatewayMint → RevenueSplit.split) end-to-end on Arc.
 *
 *   BUYER pays 0.05 USDC from their Gateway balance → a fresh creator address.
 *
 * Run from apps/web:  npx tsx scripts/live-2b.ts
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  erc20Abi,
  formatUnits,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// ── Load root .env into process.env (libs read process.env) ──────────────────
for (const line of readFileSync("../../.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const norm = (k: string) => (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) as `0x${string}`;

const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const USDC = getAddress(process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000");
const GW = getAddress(process.env.GATEWAY_WALLET_ADDRESS || "0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
const SPLIT = getAddress(process.env.REVENUE_SPLIT_ADDRESS!);
const PLATFORM = getAddress(process.env.PLATFORM_ADDRESS!);
const chain = { id: 5042002, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;

const gwAbi = [
  { name: "availableBalance", type: "function", stateMutability: "view", inputs: [{ name: "token", type: "address" }, { name: "depositor", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "addDelegate", type: "function", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "delegate", type: "address" }], outputs: [] },
] as const;
const splitViewAbi = [{ name: "reserveBalance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

const ex = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

async function main() {
  const { buildBurnIntent, toTypedMessage, GATEWAY_DOMAIN, BURN_INTENT_TYPES } = await import("../lib/burn-intent.js");
  const rel = await import("../lib/gateway-relayer.js");

  const pub = createPublicClient({ chain, transport: http(RPC) });
  const buyer = privateKeyToAccount(norm(process.env.BUYER_PRIVATE_KEY!));
  const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(RPC) });
  const session = privateKeyToAccount(generatePrivateKey());
  const creator = privateKeyToAccount(generatePrivateKey()).address; // fresh, receives 80%
  const recipient = rel.relayerRecipient();
  const value = 50_000n; // 0.05 USDC

  console.log("buyer    ", buyer.address);
  console.log("session  ", session.address, "(ephemeral delegate)");
  console.log("relayer  ", recipient);
  console.log("creator  ", creator, "(fresh — expect +0.040000)");
  console.log("platform ", PLATFORM, "(expect +0.006000)");

  const usdcOf = (a: `0x${string}`) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  const gwOf = (a: `0x${string}`) => pub.readContract({ address: GW, abi: gwAbi, functionName: "availableBalance", args: [USDC, a] });
  const reserve = () => pub.readContract({ address: SPLIT, abi: splitViewAbi, functionName: "reserveBalance" });

  const before = { creator: await usdcOf(creator), platform: await usdcOf(PLATFORM), buyerGw: await gwOf(buyer.address), reserve: await reserve() };
  console.log("\nbefore: buyerGatewayBal", formatUnits(before.buyerGw, 6), "| reserve", formatUnits(before.reserve, 6));

  // 1) Buyer authorizes the session key as a Gateway delegate.
  console.log("\n[1] addDelegate(USDC, session)…");
  try {
    const h = await buyerWallet.writeContract({ address: GW, abi: gwAbi, functionName: "addDelegate", args: [USDC, session.address], account: buyer, chain });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log("    ok", ex(h));
  } catch (e) {
    console.log("    (addDelegate skipped:", String((e as Error).message).slice(0, 80), ")");
  }

  // 2) Session key signs the burn intent (silent).
  const salt = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const wire = buildBurnIntent({ mainWallet: buyer.address, sessionAddress: session.address, recipient, value, salt });
  const signature = await session.signTypedData({ domain: GATEWAY_DOMAIN, types: BURN_INTENT_TYPES, primaryType: "BurnIntent", message: toTypedMessage(wire) });
  console.log("\n[2] burn intent signed by session key.");

  // 3) Submit burn to Gateway (/v1/transfer).
  console.log("[3] submitBurnIntent → POST /v1/transfer…");
  const { attestation, signature: opSig } = await rel.submitBurnIntent(wire, signature);
  console.log("    attestation bytes:", attestation.length / 2 - 1);

  // 4) Relayer mint + split.
  console.log("[4] ensureRevenueSplitApproval…");
  await rel.ensureRevenueSplitApproval();
  console.log("[5] relayMint(attestation)…");
  const mintTx = await rel.relayMint(attestation, opSig);
  console.log("    mint", ex(mintTx));
  console.log("[6] RevenueSplit.split(creator, 0, value)…");
  const splitTx = await rel.splitOnChain(creator, null, value);
  console.log("    split", ex(splitTx));

  // 5) Verify deltas.
  const after = { creator: await usdcOf(creator), platform: await usdcOf(PLATFORM), buyerGw: await gwOf(buyer.address), reserve: await reserve() };
  const d = (a: bigint, b: bigint) => formatUnits(a - b, 6);
  console.log("\n── RESULT ─────────────────────────────");
  console.log("creator USDC   :", formatUnits(after.creator, 6), "(Δ +" + d(after.creator, before.creator) + ")  expect 0.040000");
  console.log("platform USDC  : Δ +" + d(after.platform, before.platform) + "  expect 0.006000");
  console.log("reserveBalance :", formatUnits(after.reserve, 6), "(Δ +" + d(after.reserve, before.reserve) + ")  expect 0.004000");
  console.log("buyer GatewayΔ : " + d(after.buyerGw, before.buyerGw) + "  expect -0.050000");
}

main().then(() => process.exit(0)).catch((e) => { console.error("\nLIVE TEST ERROR:", String((e as Error)?.stack || e)); process.exit(1); });
