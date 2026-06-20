import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { issueUserToken, getEmbeddedWallet } from "@/lib/circle-wallets";
import { setEmbeddedWallet } from "@/lib/store";
import { validateWallet } from "@/lib/validate-wallet";

export const runtime = "nodejs";

/**
 * POST /api/wallet/embedded/confirm — called after the PIN/create-wallet
 * challenge resolves on the client. Reads the freshly-created wallet from Circle
 * and persists it. If the user never connected an external wallet, the embedded
 * wallet also becomes the default payout (handled in setEmbeddedWallet).
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (user.role === "admin")
      throw new HttpError(403, "admin_uses_external", "Admins sign with an external wallet.");

    const { userToken } = await issueUserToken(user.id);
    const wallet = await getEmbeddedWallet(userToken);
    if (!wallet)
      throw new HttpError(409, "wallet_not_ready", "Wallet isn't ready yet — finish the PIN setup.");

    const check = validateWallet(wallet.address);
    if (!check.valid || !check.checksummed)
      throw new HttpError(502, "bad_address", "Circle returned an invalid address.");

    const updated = await setEmbeddedWallet(user.id, wallet.id, check.checksummed);
    return Response.json({
      ok: true,
      address: check.checksummed,
      walletId: wallet.id,
      walletSource: updated?.wallet_source,
      payoutAddress: updated?.wallet_address,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
