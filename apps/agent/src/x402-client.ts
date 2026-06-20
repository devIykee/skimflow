import {
  GatewayClient,
  loadArcConfig,
  decodePayment,
  encodePayment,
  type PaymentRequiredBody,
  type PaymentRequirement,
  type SettlementReceipt,
  type Address,
  type Hex,
} from "@skimflow/sdk";

/**
 * Minimal x402 client for the buyer agent.
 *
 * `quote()` performs the unpaid GET and returns the 402 requirement (or the
 * free preview if the range is free). `payAndRead()` executes the full x402
 * handshake: GET -> 402 -> sign Gateway authorization -> retry with X-PAYMENT
 * -> receive content + settlement receipt.
 */
export class X402Client {
  private gateway: GatewayClient;
  private from: Address;
  private privateKey?: Hex;

  constructor(
    private baseUrl: string,
    opts?: { from?: Address; privateKey?: Hex }
  ) {
    const cfg = loadArcConfig();
    this.gateway = new GatewayClient(cfg);
    this.from =
      opts?.from ??
      (process.env.AGENT_WALLET_ADDRESS as Address) ??
      ("0xA9ENT0000000000000000000000000000000000" as Address);
    this.privateKey = opts?.privateKey ?? (process.env.AGENT_WALLET_PRIVATE_KEY as Hex | undefined);
  }

  private url(contentId: string, lineStart: number, lineEnd: number) {
    return `${this.baseUrl}/api/content/${contentId}?lineStart=${lineStart}&lineEnd=${lineEnd}`;
  }

  /** Free preview (the first N free lines of a piece). */
  async preview(contentId: string, lines: number): Promise<{ text: string; title: string; creator: string }> {
    const res = await fetch(this.url(contentId, 1, lines), { headers: { "x-payer-kind": "agent" } });
    const data = await res.json();
    return { text: data.text ?? "", title: data.title ?? contentId, creator: data.creator ?? "" };
  }

  /** Get the x402 quote for a paid range without paying. */
  async quote(contentId: string, lineStart: number, lineEnd: number): Promise<PaymentRequirement | null> {
    const res = await fetch(this.url(contentId, lineStart, lineEnd), {
      headers: { "x-payer-kind": "agent" },
    });
    if (res.status !== 402) return null; // free range or error
    const body = (await res.json()) as PaymentRequiredBody;
    return body.accepts[0] ?? null;
  }

  /** Full handshake: pay via Gateway and return the unlocked content. */
  async payAndRead(
    contentId: string,
    lineStart: number,
    lineEnd: number
  ): Promise<{
    requirement: PaymentRequirement;
    receipt: SettlementReceipt;
    text: string;
    contentHash: string;
    split: unknown;
  }> {
    const requirement = await this.quote(contentId, lineStart, lineEnd);
    if (!requirement) throw new Error("no_quote_returned");

    const payment = await this.gateway.createPayment(requirement, this.from, this.privateKey);

    const res = await fetch(this.url(contentId, lineStart, lineEnd), {
      headers: {
        "x-payment": encodePayment(payment),
        "x-payer-kind": "agent",
      },
    });
    if (!res.ok) {
      throw new Error(`pay_failed:${res.status}:${await res.text()}`);
    }
    const data = await res.json();
    const receiptHeader = res.headers.get("x-payment-response");
    const receipt = receiptHeader
      ? (JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8")) as SettlementReceipt)
      : (data as any);
    return {
      requirement,
      receipt,
      text: data.text,
      contentHash: data.contentHash,
      split: data.split,
    };
  }
}

export { decodePayment };
