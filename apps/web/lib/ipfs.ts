import { db } from "./db.js";
import { encrypt, decrypt, localCid } from "./crypto.js";

/**
 * Content storage for the on-chain marketplace.
 *
 * Real IPFS via Pinata when PINATA_JWT is set; otherwise a real local blob store
 * in SQLite (the mandate explicitly allows SQLite for the MVP). Either way the
 * stored bytes are AES-256-GCM ciphertext, and what goes on-chain is just the
 * CID/pointer. Plaintext is only ever returned by the gated reveal path.
 */

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs";

export const usingPinata = !!PINATA_JWT;

/** Encrypt + store, return a CID (real IPFS CID, or local://… pseudo-CID). */
export async function storeContent(plaintext: string, kind: string): Promise<string> {
  const ciphertext = encrypt(plaintext);

  if (PINATA_JWT) {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${PINATA_JWT}` },
      body: JSON.stringify({
        pinataContent: { v: 1, kind, ciphertext },
        pinataMetadata: { name: `linepay-${kind}-${Date.now()}` },
      }),
    });
    if (!res.ok) throw new Error(`pinata_failed:${res.status}:${await res.text()}`);
    const { IpfsHash } = (await res.json()) as { IpfsHash: string };
    return IpfsHash;
  }

  // Local fallback (real storage, content-addressed).
  const cid = localCid(ciphertext);
  db()
    .prepare(`INSERT OR REPLACE INTO ipfs_blobs (cid, ciphertext, kind, created_at) VALUES (?,?,?,?)`)
    .run(cid, ciphertext, kind, Date.now());
  return cid;
}

/** Fetch ciphertext by CID and decrypt. Used only after the on-chain access gate. */
export async function fetchAndDecrypt(cid: string): Promise<string> {
  let ciphertext: string;

  if (cid.startsWith("local://")) {
    const row = db().prepare(`SELECT ciphertext FROM ipfs_blobs WHERE cid = ?`).get(cid) as
      | { ciphertext: string }
      | undefined;
    if (!row) throw new Error("blob_not_found");
    ciphertext = row.ciphertext;
  } else {
    const res = await fetch(`${PINATA_GATEWAY}/${cid}`);
    if (!res.ok) throw new Error(`ipfs_fetch_failed:${res.status}`);
    const json = (await res.json()) as { ciphertext: string };
    ciphertext = json.ciphertext;
  }

  return decrypt(ciphertext);
}
