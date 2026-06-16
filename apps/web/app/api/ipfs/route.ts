import { NextRequest, NextResponse } from "next/server";
import { storeContent, usingPinata } from "@/lib/ipfs";

/**
 * Upload published content. Encrypts server-side, pins to IPFS (Pinata) when
 * configured, else stores locally in SQLite. Returns the CID to write on-chain.
 *
 * Keeping this server-side means the Pinata JWT never reaches the browser.
 *
 *   POST /api/ipfs  { text, kind }  ->  { cid, storage }
 */
export async function POST(req: NextRequest) {
  const { text, kind } = await req.json().catch(() => ({}));
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  try {
    const cid = await storeContent(text, typeof kind === "string" ? kind : "agent-skill");
    return NextResponse.json({ cid, storage: usingPinata ? "ipfs-pinata" : "local-sqlite" });
  } catch (e: any) {
    return NextResponse.json({ error: "store_failed", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
