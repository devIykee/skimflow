import { gatewayAddressFor } from "@/lib/agent-skills";
import { bumpCounter } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Agent self-discovery manifest. Exposed at /.well-known/agent-payment.json via
 * a rewrite (see next.config.mjs). Lets a crawling agent discover the payment
 * protocol, gateway address, and content URL pattern.
 */
export async function GET() {
  void bumpCounter("wellknown_hit");
  const gateway = gatewayAddressFor({ gateway_address: null });
  const costPerBlock = process.env.DEFAULT_PRICE_PER_BLOCK || "0.05";

  const manifest = {
    version: "1.1",
    // Primary protocol: x402 (HTTP 402 + X-Payment) settled over Circle Gateway.
    payment_protocol: "x402",
    settlement: "circle-gateway-eip3009",
    network: "eip155:5042002",
    currency: "USDC",
    usdc_address: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000",
    // Gateway = EIP-712 verifyingContract for the GatewayWalletBatched authorization.
    gateway_address: gateway,
    payment: {
      header: "X-Payment", // base64 { x402Version, payload: { authorization, signature } }
      response_header: "X-Payment-Response",
      eip712_domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: gateway },
      legacy_header: "X-Payment-Token", // still accepted
    },
    content_endpoints: [
      {
        type: "agent-skills",
        url_pattern: "/read/{slug}/agent-skills.md",
        free_block: 0,
        cost_per_block: costPerBlock,
        payment_header: "X-Payment",
        auth_header: "X-Payment-Token", // legacy fallback
      },
    ],
    feed: "/for-you",
    marketplace: "/for-you", // back-compat alias (the feed was formerly "/marketplace")
    docs: "/read/agent-skills.md",
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
