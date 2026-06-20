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
// line count without exceeding the word ceiling, then rewrite the body so each
// chunk is one blank-line-delimited block (paragraphs within a chunk are joined
// by single newlines, so each counts as a line for the minimum). Chunk
// boundaries always land on paragraph breaks (which are sentence-final in real
// content). A single paragraph that alone exceeds the ceiling becomes its own
// oversized chunk rather than being split mid-sentence.

const AUTO_MIN_LINES = 6;
const AUTO_MAX_WORDS = 400;

/** Non-empty, >1-char lines — mirrors countLines() in chunk-validate.ts. */
function lineCount(text: string): number {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1).length;
}

function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

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
    // Adding this paragraph would blow the ceiling — close the current chunk
    // first (unless it's empty, i.e. this single paragraph is itself oversized).
    if (cur.length > 0 && curWords + w > AUTO_MAX_WORDS) flush();
    cur.push(p);
    curWords += w;
    // Once we've met the minimum line count, close on this paragraph boundary.
    if (lineCount(cur.join("\n")) >= AUTO_MIN_LINES) flush();
  }
  flush();

  return groups.map((g) => g.join("\n")).join("\n\n");
}
