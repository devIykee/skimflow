import { createHash } from "node:crypto";
import type {
  Address,
  Hex,
  PaymentPayload,
  PaymentRequirement,
  SettlementReceipt,
} from "./types.js";
import { loadArcConfig, type ArcConfig } from "./arc.js";

/**
 * GatewayClient wraps Circle Gateway nanopayments on Arc.
 *
 * Two modes:
 *   - simulate (default): a deterministic in-process ledger. No keys, no
 *     network — perfect for the demo and CI. Settlement hashes are derived
 *     from the authorization so they're stable and verifiable.
 *   - live: signs an EIP-712 transfer authorization with the agent wallet and
 *     submits it to the Circle Gateway facilitator, which batches it (gas-free)
 *     and settles in USDC on Arc. Set PAYMENTS_MODE=live + the ARC_* env vars.
 *
 * Gateway is what makes per-line payments viable: amounts down to the
 * $0.000001 floor, batched so the buyer never pays gas per read.
 */
export class GatewayClient {
  readonly cfg: ArcConfig;

  constructor(cfg: ArcConfig = loadArcConfig()) {
    this.cfg = cfg;
  }

  /**
   * CLIENT SIDE: produce the signed `X-PAYMENT` payload for a 402 requirement.
   * In sim mode the signature is empty (the server's sim verifier accepts it);
   * in live mode we sign the authorization with the agent's private key.
   */
  async createPayment(
    req: PaymentRequirement,
    from: Address,
    privateKey?: Hex
  ): Promise<PaymentPayload> {
    // Circle requires validBefore ≥ 7 days out in live mode; sim keeps it short.
    const SEVEN_DAYS = 7 * 24 * 60 * 60 + 600;
    const window = this.cfg.simulate ? req.maxTimeoutSeconds : Math.max(req.maxTimeoutSeconds, SEVEN_DAYS);
    const validBefore = Math.floor(Date.now() / 1000) + window;
    const base = {
      from,
      to: req.payTo,
      asset: req.asset,
      amount: req.amount,
      nonce: req.nonce,
      validBefore,
    };

    let signature: Hex | "" = "";
    if (!this.cfg.simulate && privateKey) {
      signature = await this.signAuthorization(base, privateKey);
    }

    return {
      x402Version: 1,
      scheme: "gateway-exact",
      network: "arc-testnet",
      payload: { ...base, signature },
    };
  }

  /**
   * SERVER SIDE: verify + settle a payment for a requirement.
   * Returns a receipt. Throws on amount/nonce/expiry mismatch.
   */
  async settle(
    req: PaymentRequirement,
    payment: PaymentPayload
  ): Promise<SettlementReceipt> {
    const p = payment.payload;

    // --- shared verification (both modes) ---
    if (p.amount !== req.amount) throw new Error("amount_mismatch");
    if (p.to.toLowerCase() !== req.payTo.toLowerCase())
      throw new Error("recipient_mismatch");
    if (p.nonce !== req.nonce) throw new Error("nonce_mismatch");
    if (p.validBefore * 1000 < Date.now()) throw new Error("payment_expired");

    if (this.cfg.simulate) {
      return this.settleSimulated(req, payment);
    }
    return this.settleLive(req, payment);
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------
  private settleSimulated(
    req: PaymentRequirement,
    payment: PaymentPayload
  ): SettlementReceipt {
    const p = payment.payload;
    const txHash = ("0x" +
      createHash("sha256")
        .update(`${p.from}:${p.to}:${p.amount}:${p.nonce}`)
        .digest("hex")
        .slice(0, 64)) as Hex;
    return {
      success: true,
      network: "arc-testnet",
      txHash,
      batchId: `sim-batch-${p.nonce.slice(2, 10)}`,
      amount: req.amount,
      payTo: req.payTo,
      payer: p.from,
      settledAt: Date.now(),
      simulated: true,
    };
  }

  // -------------------------------------------------------------------------
  // Live Circle Gateway settlement on Arc
  //
  // Matches Circle's Settle x402 Payment API:
  //   POST {gatewayUrl}/v1/x402/settle
  //   body: { paymentPayload, paymentRequirements }
  //   200:  { success, transaction (UUID), network (CAIP-2), payer, errorReason }
  //
  // For production you would normally use the official SDK
  // (`@circle-fin/x402-batching` → BatchFacilitatorClient.settle); this raw
  // call keeps the SDK dependency optional. See packages/sdk/src/circle.ts for
  // the official-SDK wrapper.
  // -------------------------------------------------------------------------
  private async settleLive(
    req: PaymentRequirement,
    payment: PaymentPayload
  ): Promise<SettlementReceipt> {
    const p = payment.payload;

    // x402 v2 payment requirements (Circle shape).
    const paymentRequirements = {
      scheme: "exact",
      network: this.cfg.networkCaip2,
      asset: req.asset,
      amount: req.amount,
      payTo: req.payTo,
      maxTimeoutSeconds: req.maxTimeoutSeconds,
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: this.cfg.gatewayWalletAddress ?? req.asset,
      },
    };

    const paymentPayload = {
      x402Version: 2,
      accepted: paymentRequirements,
      payload: {
        signature: p.signature,
        authorization: {
          from: p.from,
          to: p.to,
          value: p.amount,
          validAfter: "0",
          validBefore: String(p.validBefore),
          nonce: p.nonce,
        },
      },
    };

    const res = await fetch(`${this.cfg.gatewayUrl}${this.cfg.settlePath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.CIRCLE_API_KEY ?? ""}`,
      },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    if (!res.ok) {
      throw new Error(`gateway_settle_failed:${res.status}:${await res.text()}`);
    }
    const data = (await res.json()) as {
      success: boolean;
      transaction: string;
      network: string;
      payer?: string;
      errorReason?: string;
    };
    if (!data.success) {
      throw new Error(`gateway_settle_rejected:${data.errorReason ?? "unknown"}`);
    }
    return {
      success: true,
      network: "arc-testnet",
      // Circle returns a transaction UUID; surface it as the receipt id.
      txHash: (data.transaction.startsWith("0x") ? data.transaction : `0x${data.transaction.replace(/-/g, "")}`) as Hex,
      batchId: data.transaction,
      amount: req.amount,
      payTo: req.payTo,
      payer: (data.payer as Address) ?? payment.payload.from,
      settledAt: Date.now(),
      simulated: false,
    };
  }

  /**
   * EIP-3009 TransferWithAuthorization signature (live mode).
   * Signed against the GatewayWalletBatched EIP-712 domain. Note Circle requires
   * `validBefore` to be at least 7 days in the future or it rejects the auth.
   */
  private async signAuthorization(
    auth: {
      from: Address;
      to: Address;
      asset: Address;
      amount: string;
      nonce: Hex;
      validBefore: number;
    },
    privateKey: Hex
  ): Promise<Hex> {
    // Lazy import so sim-mode bundles don't need viem account utils at runtime.
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(privateKey);
    return account.signTypedData({
      domain: {
        name: "GatewayWalletBatched",
        version: "1",
        chainId: this.cfg.chainId,
        verifyingContract: this.cfg.gatewayWalletAddress ?? auth.asset,
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
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.amount),
        validAfter: 0n,
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
    });
  }
}
