import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM symmetric encryption for marketplace content.
 *
 * Published text is encrypted before it leaves the server (so the ciphertext on
 * IPFS/local is useless on its own). The key is derived from CONTENT_ENCRYPTION_KEY
 * and is only ever used server-side, after an on-chain access check — that's the
 * real gate, not UI blur.
 */
function key(): Buffer {
  const secret = process.env.CONTENT_ENCRYPTION_KEY ?? "linepay-cite-dev-key-change-me";
  // Derive a stable 32-byte key from whatever secret is configured.
  return createHash("sha256").update(secret).digest();
}

/** Returns a compact "iv:tag:ciphertext" base64 envelope. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(envelope: string): string {
  const [ivB64, tagB64, dataB64] = envelope.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Content-addressed id (sha256 of the ciphertext) for the local fallback. */
export function localCid(ciphertext: string): string {
  return "local://" + createHash("sha256").update(ciphertext).digest("hex").slice(0, 46);
}
