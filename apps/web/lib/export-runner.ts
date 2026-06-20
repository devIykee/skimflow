/**
 * Async CSV export runner for large payment exports (>10k rows). Pages through
 * the ledger (never buffering the full set), writes to a temp file, and marks
 * the export_jobs row complete. NOTE: on serverless platforms the work must
 * outlive the request — see DEPLOYMENT.md (use Railway/Render or a queue).
 */
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { countLedgerForExport, ledgerCsvRows } from "./admin.js";
import { updateExportJob } from "./store.js";

export async function runExportJob(jobId: string): Promise<void> {
  try {
    await updateExportJob(jobId, { status: "processing" });
    const file = path.join(os.tmpdir(), `skimflow-export-${jobId}.csv`);
    const ws = createWriteStream(file, { encoding: "utf8" });
    for await (const line of ledgerCsvRows(2000)) {
      if (!ws.write(line)) await new Promise<void>((r) => ws.once("drain", () => r()));
    }
    await new Promise<void>((r) => ws.end(() => r()));
    const rowCount = await countLedgerForExport();
    await updateExportJob(jobId, { status: "complete", rowCount, filePath: file, completed: true });
  } catch (e) {
    console.error(`[export ${jobId}] failed:`, e);
    await updateExportJob(jobId, { status: "failed", completed: true });
  }
}
