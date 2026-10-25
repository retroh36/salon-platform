// A name's first letter as a person sees it: a whole emoji (even one made
// of several, like a family) or an accented letter, never half of one,
// which shows as a broken character. Plain Node too (relative imports).
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function firstLetter(text: string): string {
  for (const { segment } of segmenter.segment(text.trim())) return segment;
  return "";
}
