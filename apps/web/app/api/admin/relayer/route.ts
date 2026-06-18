import { requireAdmin, errorResponse } from "@/lib/session";
import { createPublicClient, http, getAddress, erc20Abi, formatUnits, formatEther } from "viem";
import { relayerRecipient } from "@/lib/gateway-relayer";
import { arc } from "@/lib/reader-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/relayer — the relayer EOA that fronts gas + mint + split for
 * every live silent payment, plus its current Arc balances so an admin knows
 * when to top it up. On-chain reads are best-effort.
 */
export async function GET() {
  try {
    await requireAdmin();

    let address: string | null = null;
    try {
      address = getAddress(relayerRecipient());
    } catch {
      address = null;
    }
    const live = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() === "live";
    const explorer = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || "https://testnet.arcscan.app";

    let usdc: string | null = null;
    let gas: string | null = null;
    if (address && address !== "0x0000000000000000000000000000000000000000") {
      try {
        const client = createPublicClient({
          chain: { id: arc.chainId, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [arc.rpcUrl] } } } as never,
          transport: http(arc.rpcUrl),
        });
        const [bal, native] = await Promise.all([
          client.readContract({ address: getAddress(arc.usdcAddress), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] }) as Promise<bigint>,
          client.getBalance({ address: getAddress(address) }),
        ]);
        usdc = formatUnits(bal, 6);
        gas = formatEther(native);
      } catch {
        /* RPC hiccup — leave balances null */
      }
    }

    // Warn when the relayer can't comfortably cover gas + fees for more payments.
    const lowBalance = usdc != null ? Number(usdc) < 0.5 : false;

    return Response.json({
      address,
      live,
      usdc,
      gas,
      lowBalance,
      explorerUrl: address ? `${explorer}/address/${address}` : null,
      faucetUrl: "https://faucet.circle.com",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
