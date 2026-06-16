import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, verifyMessage, type Address } from "viem";
import { fetchAndDecrypt } from "@/lib/ipfs";
import { AGENT_MARKETPLACE_ABI } from "@/lib/marketplaceAbi";

/**
 * Gated content reveal. This is the REAL access gate (not UI blur):
 *
 *   1. Verify the caller owns `address` by checking a signed message.
 *   2. Read `hasAccess(id, address)` straight from the AgentMarketplace contract
 *      on Arc — true only if they're the author or paid on-chain.
 *   3. Only then fetch the ciphertext (IPFS/local), decrypt, and return plaintext.
 *
 *   POST /api/reveal { id, cid, address, message, signature }
 */
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const MARKETPLACE = (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS ?? "") as Address;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, cid, address, message, signature } = body as {
    id?: number | string;
    cid?: string;
    address?: Address;
    message?: string;
    signature?: `0x${string}`;
  };

  if (id === undefined || !cid || !address || !message || !signature) {
    return NextResponse.json({ error: "id, cid, address, message, signature required" }, { status: 400 });
  }

  // 1) Signature proves wallet ownership; bind it to this content id + freshness.
  let validSig = false;
  try {
    validSig = await verifyMessage({ address, message, signature });
  } catch {
    validSig = false;
  }
  if (!validSig) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  if (!message.includes(`content #${id}`)) {
    return NextResponse.json({ error: "signature_scope_mismatch" }, { status: 401 });
  }
  const tsMatch = message.match(/ts=(\d+)/);
  if (!tsMatch || Date.now() - Number(tsMatch[1]) > 10 * 60 * 1000) {
    return NextResponse.json({ error: "signature_expired" }, { status: 401 });
  }

  if (!MARKETPLACE) {
    return NextResponse.json({ error: "marketplace_not_configured" }, { status: 503 });
  }

  // 2) On-chain access check — the actual gate.
  try {
    const client = createPublicClient({
      chain: { id: CHAIN_ID, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as any,
      transport: http(RPC_URL),
    });
    const allowed = (await client.readContract({
      abi: AGENT_MARKETPLACE_ABI,
      address: MARKETPLACE,
      functionName: "hasAccess",
      args: [BigInt(id), address],
    })) as boolean;

    if (!allowed) return NextResponse.json({ error: "no_on_chain_access" }, { status: 403 });

    // 3) Decrypt + return.
    const text = await fetchAndDecrypt(cid);
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json({ error: "reveal_failed", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
