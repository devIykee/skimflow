/**
 * Agent-skills consumer — the autonomous A2A flow against the chunk system.
 *
 *   1. Discover the payment system via /.well-known/agent-payment.json
 *   2. Fetch the free block 0 (onboarding) of a piece
 *   3. For each block 1..N: GET → 402 → sign an x402 USDC authorization → retry
 *      with the `X-Payment` header → read.
 *
 * x402 (preferred): the 402 body carries an `accepts[]` quote. The agent signs an
 * EIP-3009 `TransferWithAuthorization` (GatewayWalletBatched domain) for the
 * creator's wallet and sends it base64 in `X-Payment`; the server settles it via
 * Circle Gateway. In simulate mode the signature is empty and the server
 * validate-and-records (no funds move). Legacy `X-Payment-Token` is used only if
 * a server doesn't advertise `accepts[]`.
 */
import { loadArcConfig, type Address, type Hex } from "@linepay/sdk";

export interface AgentSkillsOptions {
  baseUrl: string;
  slug: string;
  simulate: boolean;
  maxBlocks?: number;
}

export interface BlockTrace {
  blockIndex: number;
  status: "paid" | "402" | "stopped";
  method?: "x402" | "token";
  token?: string;
  cost?: string;
  chars?: number;
  rateRemaining?: string | null;
}

/** One entry of the x402 402 `accepts[]` quote. */
interface AcceptQuote {
  network: string;
  asset: Address;
  amount: string; // USDC base units
  payTo: Address;
  maxTimeoutSeconds?: number;
  extra?: { verifyingContract?: Address };
}

const SIM_FROM = "0x000000000000000000000000000000000000A9E7" as Address;

/**
 * Build the base64 `X-Payment` header: a signed (live) or empty-sig (simulate)
 * EIP-3009 authorization toward the quote's `payTo`.
 */
async function buildXPayment(accept: AcceptQuote, simulate: boolean, chainId: number): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const now = Math.floor(Date.now() / 1000);
  const validAfter = "0";
  const validBefore = String(now + Math.max(Number(accept.maxTimeoutSeconds ?? 600), 7 * 24 * 3600 + 100));

  let from: Address = (process.env.BUYER_ADDRESS ?? process.env.AGENT_WALLET_ADDRESS ?? SIM_FROM) as Address;
  let signature: Hex | "0x" = "0x";

  if (!simulate) {
    const pk = (process.env.BUYER_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY) as Hex | undefined;
    if (!pk) throw new Error("Live mode needs BUYER_PRIVATE_KEY (a funded Arc wallet) to sign x402 payments.");
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(pk);
    from = account.address;
    signature = await account.signTypedData({
      domain: {
        name: "GatewayWalletBatched",
        version: "1",
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
    scheme: "exact",
    network: accept.network,
    payload: {
      authorization: { from, to: accept.payTo, value: accept.amount, validAfter, validBefore, nonce },
      signature,
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export interface AgentSkillsResult {
  discovery: Record<string, unknown> | null;
  block0: string;
  blocks: BlockTrace[];
  spent: string;
}

function agentUrl(baseUrl: string, slug: string, block?: number): string {
  const u = `${baseUrl.replace(/\/$/, "")}/read/${slug}/agent-skills.md`;
  return block === undefined ? u : `${u}?block=${block}`;
}

/** Pay for a block; returns an X-Payment-Token. */
async function pay(cost: string, gateway: string, simulate: boolean): Promise<string> {
  if (simulate) {
    // Deterministic-enough unique token; the server auto-approves in simulate.
    return `sim_${Date.now().toString(36)}_${process.hrtime.bigint().toString(36).slice(-6)}`;
  }
  // Live: send USDC to the gateway address on Arc; the tx hash is the token,
  // reconciled by the Circle webhook (payment.confirmed paymentId=txHash).
  const privateKey = (process.env.BUYER_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY) as Hex | undefined;
  if (!privateKey) {
    throw new Error("Live mode needs BUYER_PRIVATE_KEY (a funded Arc testnet wallet) to pay.");
  }
  const { createWalletClient, defineChain, http, parseUnits, erc20Abi, getAddress } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const arc = loadArcConfig();
  const account = privateKeyToAccount(privateKey);
  const chain = defineChain({
    id: arc.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [arc.rpcUrl] } },
  });
  const wallet = createWalletClient({ account, chain, transport: http(arc.rpcUrl) });
  const hash = await wallet.writeContract({
    address: getAddress(arc.usdcAddress),
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(gateway), parseUnits(cost, 6)],
    account,
    chain,
  });
  return hash;
}

export async function runAgentSkills(opts: AgentSkillsOptions): Promise<AgentSkillsResult> {
  const { baseUrl, slug, simulate } = opts;
  const maxBlocks = opts.maxBlocks ?? 50;
  const chainId = loadArcConfig().chainId;

  // 1. Discover
  let discovery: Record<string, unknown> | null = null;
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/.well-known/agent-payment.json`);
    if (r.ok) discovery = (await r.json()) as Record<string, unknown>;
  } catch {
    /* discovery optional */
  }

  // 2. Block 0 (free)
  const b0 = await fetch(agentUrl(baseUrl, slug, 0));
  const block0 = await b0.text();

  // 3. Sequential paid blocks
  const blocks: BlockTrace[] = [];
  let spentUnits = 0;
  for (let i = 1; i <= maxBlocks; i++) {
    const unpaid = await fetch(agentUrl(baseUrl, slug, i));
    if (unpaid.status === 404) {
      blocks.push({ blockIndex: i, status: "stopped" });
      break;
    }
    if (unpaid.status !== 402) {
      // Already free or unexpected — record and continue.
      blocks.push({ blockIndex: i, status: "stopped" });
      break;
    }
    const quote = (await unpaid.json()) as {
      cost_per_block: string;
      payment_gateway?: string;
      accepts?: AcceptQuote[];
    };
    const cost = quote.cost_per_block;
    const accept = quote.accepts?.[0];

    let paid: Response;
    let method: "x402" | "token";
    let token: string | undefined;

    if (accept) {
      // x402: sign a USDC authorization and pay machine-to-machine.
      method = "x402";
      const xPayment = await buildXPayment(accept, simulate, chainId);
      paid = await fetch(agentUrl(baseUrl, slug, i), { headers: { "X-Payment": xPayment } });
    } else {
      // Legacy fallback: opaque payment token.
      method = "token";
      token = await pay(cost, quote.payment_gateway ?? "", simulate);
      paid = await fetch(agentUrl(baseUrl, slug, i), { headers: { "X-Payment-Token": token } });
    }

    if (!paid.ok) {
      blocks.push({ blockIndex: i, status: "402", method, token, cost });
      break;
    }
    const text = await paid.text();
    spentUnits += Math.round(Number(cost) * 1e6);
    blocks.push({
      blockIndex: i,
      status: "paid",
      method,
      token,
      cost,
      chars: text.length,
      rateRemaining: paid.headers.get("x-ratelimit-remaining"),
    });
  }

  return { discovery, block0, blocks, spent: (spentUnits / 1e6).toFixed(6) };
}
