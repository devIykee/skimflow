import { NextRequest } from "next/server";
import { parseUnits } from "viem";
import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { issueUserToken, createContractExecChallenge } from "@/lib/circle-wallets";
import { validateWallet } from "@/lib/validate-wallet";
import { normalizeUsdc } from "@/lib/money";
import { GATEWAY_WALLET_ADDRESS, ARC_USDC_ADDRESS } from "@/lib/burn-intent";

export const runtime = "nodejs";

/**
 * POST /api/wallet/embedded/setup — create ONE contract-execution challenge for
 * the silent-payment setup, executed by the embedded (SCA) wallet via the Web
 * SDK + PIN. Steps mirror the external wagmi flow in PaySetupModal:
 *   approve     → USDC.approve(gatewayWallet, cap)
 *   deposit     → GatewayWallet.deposit(usdc, cap)
 *   addDelegate → GatewayWallet.addDelegate(usdc, sessionAddress)
 *
 * The per-block burn intent is still signed by the local EOA session key, so
 * nothing here changes the burn/verify path — only how the SCA deposits+delegates.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role === "admin")
      throw new HttpError(403, "admin_uses_external", "Admins sign with an external wallet.");
    if (!user.embedded_wallet_id)
      throw new HttpError(409, "no_embedded_wallet", "Create your free wallet first.");

    const body = (await req.json().catch(() => ({}))) as {
      step?: "approve" | "deposit" | "addDelegate";
      cap?: string | number;
      sessionAddress?: string;
    };
    const { userToken, encryptionKey } = await issueUserToken(user.id);
    const walletId = user.embedded_wallet_id;

    let challengeId: string;
    if (body.step === "approve" || body.step === "deposit") {
      let capWei: bigint;
      try {
        capWei = parseUnits(normalizeUsdc(String(body.cap ?? "")), 6);
      } catch {
        throw new HttpError(400, "bad_cap", "Enter a valid deposit amount.");
      }
      if (capWei <= 0n) throw new HttpError(400, "bad_cap", "Deposit must be greater than 0.");

      challengeId =
        body.step === "approve"
          ? await createContractExecChallenge({
              userToken,
              walletId,
              contractAddress: ARC_USDC_ADDRESS,
              abiFunctionSignature: "approve(address,uint256)",
              abiParameters: [GATEWAY_WALLET_ADDRESS, capWei.toString()],
            })
          : await createContractExecChallenge({
              userToken,
              walletId,
              contractAddress: GATEWAY_WALLET_ADDRESS,
              abiFunctionSignature: "deposit(address,uint256)",
              abiParameters: [ARC_USDC_ADDRESS, capWei.toString()],
            });
    } else if (body.step === "addDelegate") {
      const sess = validateWallet(body.sessionAddress);
      if (!sess.valid || !sess.checksummed)
        throw new HttpError(400, "bad_session_address", "Invalid session key.");
      challengeId = await createContractExecChallenge({
        userToken,
        walletId,
        contractAddress: GATEWAY_WALLET_ADDRESS,
        abiFunctionSignature: "addDelegate(address,address)",
        abiParameters: [ARC_USDC_ADDRESS, sess.checksummed],
      });
    } else {
      throw new HttpError(400, "bad_step", "Unknown setup step.");
    }

    return Response.json({ challengeId, userToken, encryptionKey });
  } catch (e) {
    return errorResponse(e);
  }
}
