/**
 * Chunk validation for article-type content (the pay-per-block reading type).
 *
 * Rules (confirmed defaults):
 *  - Minimum 6 "lines" per chunk, counted as WRAPPED lines (~80 chars each), not
 *    raw newlines — imported prose (Medium/Turndown) puts a whole paragraph on
 *    one soft-wrapped line, so counting raw newlines would conflict with the word
 *    ceiling. A line that is whitespace or a single character contributes 0, so
 *    one-char-per-line padding still can't inflate the count. The LAST chunk is
 *    exempt (final-chunk exception) — this also covers single-chunk short posts.
 *  - Maximum 400 words per chunk. Exception: a chunk that is a single sentence
 *    longer than the ceiling can't be split without breaking the no-mid-sentence
 *    rule, so it's a warning (allowed), not a blocking error.
 *  - Every chunk boundary must fall on a sentence ending (`.`, `!`, `?`, optional
 *    trailing quotes/parens/emphasis markers) OR on a structural markdown line
 *    (heading, list item, blockquote, table, image, link, code fence, rule),
 *    which are complete units rather than mid-sentence breaks. The final chunk's
 *    end is the document end, not a split point, so it's exempt from this check.
 *
 * These rules apply only to the 'article' content type. 'agent-skills' is not
 * paginated paid-reading content and is never chunk-validated; 'picture'
 * (Skim-Flow) has its own per-image rules.
 */

export const MIN_LINES = 6;
export const MAX_WORDS = 400;
const CHARS_PER_LINE = 80;

/**
 * Count wrapped lines. Each non-empty hard line longer than one character counts
 * as ceil(length / 80) lines, so a substantial paragraph (one soft-wrapped line
 * in imported markdown) registers as several lines. Whitespace and single-char
 * lines contribute 0 — the one-char-per-line abuse guard.
 */
export function countLines(text: string): number {
  return text.split(/\r?\n/).reduce((n, raw) => {
    const t = raw.trim();
    if (t.length <= 1) return n;
    return n + Math.max(1, Math.ceil(t.length / CHARS_PER_LINE));
  }, 0);
}

/** Structural markdown lines are complete units, not mid-sentence prose breaks. */
function isStructuralLine(line: string): boolean {
  const l = line.trim();
  if (!l) return false;
  return (
    /^#{1,6}\s/.test(l) ||                 // heading
    /^([-*+]|\d+[.)])\s/.test(l) ||        // list item
    /^>/.test(l) ||                         // blockquote
    /^\|/.test(l) ||                        // table row
    /^```/.test(l) ||                       // code fence
    /^(-{3,}|\*{3,}|_{3,})$/.test(l) ||     // horizontal rule
    /^!\[.*\]\(.*\)$/.test(l) ||            // standalone image
    /\]\([^)]*\)$/.test(l) ||               // ends on a markdown link/image
    l === "[" || /^\]\(/.test(l)            // stray link-bracket lines (Medium)
  );
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Rough sentence count — number of sentence terminators that are followed by
 * whitespace or end-of-text. Used only to decide the single-long-sentence
 * exception, so an approximation is fine.
 */
export function countSentences(text: string): number {
  const m = text.trim().match(/[.!?]+["'”’)\]]*(?=\s|$)/g);
  return m ? m.length : 0;
}

/**
 * Does the chunk end at a legitimate boundary? True when the last non-empty line
 * is a structural markdown element, or ends on a sentence terminator allowing
 * trailing quotes/parens/brackets and markdown emphasis markers (* _ `) — so a
 * paragraph ending in **bold.** or a heading isn't flagged as mid-sentence.
 */
export function endsOnSentenceBoundary(text: string): boolean {
  const lines = text.trimEnd().split(/\r?\n/);
  const last = (lines[lines.length - 1] ?? "").trim();
  if (!last) return false;
  if (isStructuralLine(last)) return true;
  return /[.!?]["'”’)\]*_`]*$/.test(last);
}

export interface ChunkValidation {
  /** 1-based, user-facing chunk number. */
  number: number;
  lines: number;
  words: number;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an ordered list of chunk texts (block 0 first, final chunk last).
 * Returns one result per chunk; `errors` block publish, `warnings` don't.
 */
export function validateArticleChunks(texts: string[]): ChunkValidation[] {
  const lastIndex = texts.length - 1;
  return texts.map((text, i) => {
    const isFinal = i === lastIndex;
    const lines = countLines(text);
    const words = countWords(text);
    const errors: string[] = [];
    const warnings: string[] = [];
    const n = i + 1;

    // Minimum line count — every chunk except the final one.
    if (!isFinal && lines < MIN_LINES) {
      errors.push(`Chunk ${n} has only ${lines} line${lines === 1 ? "" : "s"} — minimum is ${MIN_LINES}.`);
    }

    // Word ceiling — single-sentence overflow is unsplittable, so warn not block.
    if (words > MAX_WORDS) {
      if (countSentences(text) <= 1) {
        warnings.push(
          `Chunk ${n} is ${words} words — over the ${MAX_WORDS}-word guideline, but it's one long sentence so it can't be split further.`
        );
      } else {
        errors.push(`Chunk ${n} is ${words} words — over the ${MAX_WORDS}-word limit. Break it at a sentence end.`);
      }
    }

    // Sentence boundary — every split point (i.e. every chunk except the final).
    if (!isFinal && text.trim().length > 0 && !endsOnSentenceBoundary(text)) {
      errors.push(`Chunk ${n} ends mid-sentence — move the break to the end of a sentence.`);
    }

    return { number: n, lines, words, errors, warnings };
  });
}

/** True if any chunk has a blocking error. */
export function hasBlockingErrors(results: ChunkValidation[]): boolean {
  return results.some((r) => r.errors.length > 0);
}
