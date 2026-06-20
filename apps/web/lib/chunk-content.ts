/**
 * Content chunker. Splits a creator's source text into payable blocks.
 *
 *  - 'article'  → split on blank-line paragraph boundaries (\n\n), drop empties.
 *  - 'markdown' → split on H2/H3 headings or `## Skill:` block boundaries, so
 *                 each skill/section becomes one payable block.
 *
 * The agent-skills content type uses 'markdown'. Block 0 (the free onboarding
 * block) is generated separately at publish time — this utility only splits the
 * creator's own body.
 */
import { countLines as lineCount, countWords as wordCount, MIN_LINES, MAX_WORDS } from "./chunk-validate.js";

export type ChunkFormat = "article" | "markdown";

export interface Chunk {
  id: string;
  text: string;
  index: number;
}

export interface ChunkInput {
  content: string;
  format: ChunkFormat;
}

/** Heading or skill-block boundary: H2/H3 (## / ###) at line start. */
const MD_BOUNDARY = /^#{2,3}\s+/;

function chunkArticle(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function chunkMarkdown(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join("\n").trim();
    if (text.length > 0) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    if (MD_BOUNDARY.test(line) && current.some((l) => l.trim().length > 0)) {
      // Start a new block at each H2/H3 boundary (keeps the heading with its body).
      flush();
    }
    current.push(line);
  }
  flush();

  // Fallback: if there were no headings at all, behave like article chunking so
  // a heading-less markdown file still produces sensible blocks.
  return blocks.length > 0 ? blocks : chunkArticle(content);
}

export function chunkContent({ content, format }: ChunkInput): Chunk[] {
  const raw = (content ?? "").trim();
  if (!raw) return [];
  const texts = format === "markdown" ? chunkMarkdown(raw) : chunkArticle(raw);
  return texts.map((text, index) => ({ id: `blk_${index}`, text, index }));
}

// ── Auto-chunk ────────────────────────────────────────────────────────────────
// Greedily group consecutive paragraphs into chunks that satisfy the minimum
// (wrapped) line count without exceeding the word ceiling, then rewrite the body
// so each chunk is one blank-line-delimited block (paragraphs within a chunk are
// joined by single newlines). Lines are counted the same wrapped way as
// chunk-validate.ts, so the two never disagree. A new chunk is preferentially
// started at a heading (once the minimum is met) so headings lead their section
// instead of being stranded at the end of the previous chunk. A single paragraph
// that alone exceeds the ceiling becomes its own oversized chunk rather than
// being split mid-sentence.

const isHeading = (p: string): boolean => /^#{1,6}\s/.test(p.trim());

/**
 * Rewrite an article body so blank-line-delimited blocks are sensible chunks.
 * Returns the regrouped body text (chunks separated by a blank line).
 */
export function autoChunkArticle(content: string): string {
  const paragraphs = (content ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+$/gm, "").trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return "";

  const groups: string[][] = [];
  let cur: string[] = [];
  let curWords = 0;

  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    curWords = 0;
  };

  for (const p of paragraphs) {
    const w = wordCount(p);
    // Start a fresh chunk at a heading once the current one already qualifies,
    // so a heading begins its section rather than ending the previous chunk.
    if (cur.length > 0 && isHeading(p) && lineCount(cur.join("\n")) >= MIN_LINES) flush();
    // Adding this paragraph would blow the ceiling — close the current chunk
    // first (unless it's empty, i.e. this single paragraph is itself oversized).
    if (cur.length > 0 && curWords + w > MAX_WORDS) flush();
    cur.push(p);
    curWords += w;
    // Once we've met the minimum line count, close on this paragraph boundary —
    // but not if the chunk would end on a heading (let its body join it).
    if (lineCount(cur.join("\n")) >= MIN_LINES && !isHeading(p)) flush();
  }
  flush();

  return groups.map((g) => g.join("\n")).join("\n\n");
}
