/**
 * Chunk validation for article-type content (the pay-per-block reading type).
 *
 * Rules (confirmed defaults):
 *  - Minimum 6 "lines" per chunk. A "line" = a text line that is non-empty after
 *    trimming AND longer than a single character, so one-char-per-line padding
 *    can't inflate the count. The LAST chunk of a piece is exempt (final-chunk
 *    exception) — this also covers single-chunk short posts.
 *  - Maximum 400 words per chunk. Exception: a chunk that is a single sentence
 *    longer than the ceiling can't be split without breaking the no-mid-sentence
 *    rule, so it's a warning (allowed), not a blocking error.
 *  - Every chunk boundary must fall on a sentence ending (`.`, `!`, `?`, or a
 *    closing quote/paren immediately following one). The final chunk's end is the
 *    end of the document, not a split point, so it's exempt from this check.
 *
 * These rules apply only to the 'article' content type. 'agent-skills' is not
 * paginated paid-reading content and is never chunk-validated; 'picture'
 * (Skim-Flow) has its own per-image rules.
 */

export const MIN_LINES = 6;
export const MAX_WORDS = 400;

/** Count lines that meaningfully contribute: non-empty after trim and >1 char. */
export function countLines(text: string): number {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1).length;
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

/** Does the text end on a sentence terminator (allowing trailing quotes/parens)? */
export function endsOnSentenceBoundary(text: string): boolean {
  return /[.!?]["'”’)\]]*\s*$/.test(text.trimEnd());
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
