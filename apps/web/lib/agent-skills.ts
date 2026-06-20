/**
 * Agent-skills helpers: the auto-generated free block 0 (self-onboarding) and
 * the HTTP 402 payment-required body. Block 0 is NEVER written by the creator —
 * it's regenerated from their pricing + gateway address on every request, so it
 * always reflects the current settings.
 */
import type { Content } from "./types.js";

/** Resolve the Circle Gateway address an agent pays for this content. */
export function gatewayAddressFor(content: Pick<Content, "gateway_address">): string {
  return (
    content.gateway_address ||
    process.env.CIRCLE_GATEWAY_ADDRESS ||
    process.env.GATEWAY_WALLET_ADDRESS ||
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
  );
}

export interface Block0Input {
  title: string;
  slug: string;
  summary: string;
  creatorHandle: string | null;
  pricePerBlock: string; // decimal USDC
  gatewayAddress: string;
  payableBlocks: number; // blocks 1..N
  baseUrl: string;
}

/** Build the free, machine-readable onboarding block (markdown). */
export function buildBlock0(i: Block0Input): string {
  const url = `${i.baseUrl}/read/${i.slug}/agent-skills.md`;
  return `# ${i.title}

> Free onboarding block (block 0). No payment required.

${i.summary ? i.summary + "\n" : ""}
**Author:** @${i.creatorHandle ?? "unknown"}

## What's in this file
This file exposes **${i.payableBlocks} payable block(s)** (block 1 through ${i.payableBlocks}).
Each block is a self-contained skill/section you can purchase and read independently.

## Pricing
- **Cost per block:** \`${i.pricePerBlock} USDC\`
- **Currency:** USDC (Arc testnet, 6 decimals)
- **Payment protocol:** x402 over Circle Gateway (EIP-3009 batched settlement)
- **Gateway (EIP-712 verifyingContract):** \`${i.gatewayAddress}\`

## How to pay — x402 (recommended)
1. Request a block with NO payment to get the quote:
   \`\`\`
   GET ${url}?block=1
   → HTTP 402 Payment Required
   \`\`\`
   The 402 body has an \`accepts[]\` array (standard x402). Each entry gives the
   \`amount\` (USDC base units), \`asset\` (USDC), \`payTo\` (the creator's wallet),
   \`network\` (eip155:5042002), and \`extra.verifyingContract\` (the Gateway).
2. Sign an EIP-3009 \`TransferWithAuthorization\` for \`payTo\` (EIP-712 domain
   \`{ name: "GatewayWalletBatched", version: "1", chainId: 5042002,
   verifyingContract }\`). Base64-encode \`{ x402Version: 2, payload: {
   authorization: { from, to, value, validAfter, validBefore, nonce },
   signature } }\`.
3. Retry with the \`X-Payment\` header:
   \`\`\`
   GET ${url}?block=1
   X-Payment: <base64 payload>
   \`\`\`
   The server verifies + settles via Circle Gateway and returns the block plus an
   \`X-Payment-Response\` header (base64 receipt: txHash, payer, amount).

## Legacy fallback (still supported)
Pay \`${i.pricePerBlock} USDC\` out-of-band and retry with \`X-Payment-Token: <tx
or token>\`. The block is served optimistically and reconciled by webhook.

## Worked example (x402)
\`\`\`
$ curl -i "${url}?block=1"
HTTP/1.1 402 Payment Required
{
  "x402Version": 2,
  "error": "X-Payment header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:5042002",
    "asset": "<USDC>",
    "amount": "<base units of ${i.pricePerBlock}>",
    "payTo": "<creator wallet>",
    "extra": { "name": "GatewayWalletBatched", "version": "1", "verifyingContract": "${i.gatewayAddress}" }
  }],
  "cost_per_block": "${i.pricePerBlock}",
  "currency": "USDC"
}

$ curl -i -H "X-Payment: <base64>" "${url}?block=1"
HTTP/1.1 200 OK
X-Payment-Response: <base64 receipt>
X-Payment-Status: completed
... block 1 content ...
\`\`\`

Repeat for block 2, 3, … up to ${i.payableBlocks} to consume the whole file.
`;
}

/** The HTTP 402 payment-required JSON body (spec shape). */
export function paymentRequiredBody(args: {
  blockIndex: number;
  gatewayAddress: string;
  costPerBlock: string;
}): Record<string, unknown> {
  return {
    error: "Payment required",
    block_index: args.blockIndex,
    payment_gateway: args.gatewayAddress,
    cost_per_block: args.costPerBlock,
    currency: "USDC",
    instructions:
      "Send payment via Circle Gateway, then retry with header: X-Payment-Token: <token>",
  };
}
