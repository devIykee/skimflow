/**
 * Exercise the REAL withGateway() middleware against live Circle in one call:
 * build an agent X-Payment, run it through withGateway, expect a 200 + receipt.
 *   npx tsx scripts/live-withgateway.ts
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

for (const line of readFileSync("../../.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.PAYMENTS_MODE = "live";
const norm = (k: string) => (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) as `0x${string}`;
const GW = getAddress(process.env.GATEWAY_WALLET_ADDRESS || "0x0077777d7EBA4688BDeF3E311b846F25870A19B9");

async function main() {
  const { withGateway } = await import("../lib/x402-gateway.js");
  const buyer = privateKeyToAccount(norm(process.env.BUYER_PRIVATE_KEY!));
  const creator = privateKeyToAccount(generatePrivateKey()).address;
  const amount = "50000";
  const now = Math.floor(Date.now() / 1000);
  const validBefore = String(now + 7 * 24 * 3600 + 600);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const authorization = { from: buyer.address, to: getAddress(creator), value: amount, validAfter: "0", validBefore, nonce };
  const signature = await buyer.signTypedData({
    domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: GW },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { from: buyer.address, to: getAddress(creator), value: BigInt(amount), validAfter: 0n, validBefore: BigInt(validBefore), nonce },
  });
  const xPayment = Buffer.from(JSON.stringify({ x402Version: 2, payload: { authorization, signature } })).toString("base64");

  const req = new NextRequest("https://skimflow.cite/read/demo/agent-skills.md?block=1", { headers: { "X-Payment": xPayment } });
  console.log("Calling withGateway() in LIVE mode (payTo fresh creator", creator + ")…");
  const res = await withGateway(
    req,
    { price: "0.05", payTo: getAddress(creator), resource: "https://skimflow.cite/read/demo/agent-skills.md?block=1", description: "Unlock block 1", blockIndex: 1 },
    async (receipt) => new Response(`BLOCK CONTENT (paid by ${receipt.payer}, tx ${receipt.txHash}, sim=${receipt.simulated})`, { status: 200 })
  );
  console.log("HTTP status:", res.status);
  console.log("body:", await res.text());
  const xpr = res.headers.get("X-Payment-Response");
  console.log("X-Payment-Response:", xpr ? JSON.parse(Buffer.from(xpr, "base64").toString()) : "(none)");
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", String((e as Error)?.stack || e)); process.exit(1); });
