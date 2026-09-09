/**
 * NaturalSort – Deterministic natural numeric collation utility.
 *
 * Implements human-friendly natural sort order:
 *  - Numbers inside strings are compared numerically (e.g. "image_1", "image_2", "image_10")
 *  - Ties in numeric chunks use deterministic secondary collation (e.g. "image1", "image1a", "image1b")
 *  - Distinct representations of the same numeric value (e.g. "01.jpg" vs "1.jpg")
 *    are stably sorted by raw string representation and flagged as ambiguous.
 *  - Never silently collapses or discards duplicate items.
 */

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/**
 * Deterministic natural comparator for two strings.
 * Guarantees strict total ordering:
 * 1. Primary natural collation (numeric chunks treated as integers).
 * 2. Secondary raw character code comparison if primary returns 0 (e.g., "01.jpg" vs "1.jpg" or case differences).
 */
export function naturalCompare(a: string, b: string): number {
  if (a === b) return 0;
  const cmp = collator.compare(a, b);
  if (cmp !== 0) return cmp;
  // Deterministic tie-breaker for identical natural representations (e.g. "01" vs "1")
  return a < b ? -1 : 1;
}

/**
 * Naturally sorts an array of items using a key extractor or the string itself.
 * Creates a new array without mutating the input.
 */
export function naturalSort<T>(items: T[], keyFn?: (item: T) => string): T[] {
  const getKey = keyFn ?? ((item: T) => String(item));
  return [...items].sort((a, b) => naturalCompare(getKey(a), getKey(b)));
}

export interface NumericAmbiguityGroup {
  extractedNumber: number;
  files: string[];
}

/**
 * Extracts leading or embedded sequence numbers from a filename.
 * E.g. "img_01.jpg" -> 1, "002_photo.png" -> 2, "3.webp" -> 3.
 */
export function extractFirstNumericSequence(filename: string): number | null {
  const match = filename.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

export const extractLeadingOrEmbeddedNumber = extractFirstNumericSequence;

/**
 * Checks for ambiguous numeric ordering among a list of filenames.
 * E.g., if both "01.jpg" and "1.jpg" exist, they share the same numeric index 1.
 * Returns groups of ambiguous files so the UI or importer can display a clear warning.
 */
export function detectAmbiguousNumericOrder(filenames: string[]): NumericAmbiguityGroup[] {
  const map = new Map<number, string[]>();

  for (const fn of filenames) {
    const num = extractFirstNumericSequence(fn);
    if (num !== null) {
      const existing = map.get(num) ?? [];
      existing.push(fn);
      map.set(num, existing);
    }
  }

  const ambiguous: NumericAmbiguityGroup[] = [];
  for (const [extractedNumber, files] of map.entries()) {
    if (files.length > 1) {
      ambiguous.push({ extractedNumber, files });
    }
  }

  return ambiguous.sort((a, b) => a.extractedNumber - b.extractedNumber);
}
