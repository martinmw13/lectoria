// One English word, ASCII letters with inner apostrophes or hyphens
// ("don't", "well-known"). Shared by the reader menu and the proxy.
const WORD_RE = /^[a-z]+(?:['-][a-z]+)*$/;

export function normalizeWord(raw: string): string | null {
  const word = raw
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .toLowerCase();
  return word.length > 0 && word.length <= 40 && WORD_RE.test(word) ? word : null;
}
