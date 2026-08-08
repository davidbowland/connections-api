// Comparison keys used to reject a generated category that repeats one already in history.
//
// The governing requirement is ZERO false positives: a false match silently discards an otherwise
// valid game and burns a generation attempt with no diagnosable cause. Under-matching is explicitly
// acceptable -- semantic paraphrase is caught by a separate mechanism -- so every tradeoff here is
// decided in favor of keeping distinct names distinct.
//
// Stemming is deliberately absent. A "-s" stemmer only caught paraphrases that also change
// grammatical number, and in exchange it collides a singular noun ending in "s" with a different
// word's plural: "Blues songs"/"Blue songs", "News shows"/"New shows", "Times headlines"/"Time
// headlines", and likewise means/mean, odds/odd, arms/arm, lens/len, species/specie. Pure
// reordering ("Homophones of body parts" vs "Body parts homophones") still matches without it,
// so the stemmer is not worth its false positives.
//
// Leading articles are deliberately NOT stripped either. Stripping them merged "A ___", "AN ___",
// "THE ___" and "___", which are four different categories, and blank-bearing names have no token
// key to fall back on. Articles remain stopwords in tokenKey, which is where that normalization
// belongs.

// Words that carry the category's mechanic and must never be stripped: removing them would
// collapse "Words after SWEET" and "Words before SWEET" into the same key.
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
])

const BLANK_SENTINEL = '___'

const DIACRITICS = /\p{Diacritic}/gu
// A lone hyphen between word characters joins one word ("Black-and-white things"); it is a word
// separator, not a blank. Checked before BLANK_RUN so the blank scan only sees standalone dashes.
const INTRA_WORD_HYPHEN = /(?<=[a-z0-9])-(?=[a-z0-9])/gi
// Any run -- including a run of one -- of underscore, ASCII hyphen, Unicode dash (U+2010-U+2015,
// U+2212), fullwidth underscore, or ellipsis marks a blank. Length-1 markers must be caught too:
// otherwise "BALL -" and "- BALL" both reduce to "ball" and the positional guard is defeated.
const BLANK_RUN = /(?:\.\.\.|[-_\u2010-\u2015\u2212\u2026\uFF3F])+/g
// Remaining punctuation becomes a SPACE, never nothing: deleting it merged "Rock/pop genres" into
// "rockpop genres".
const NON_KEY_CHARS = /[^a-z0-9_\s]/gi
const WHITESPACE_RUN = /\s+/g

// Case is preserved here so tokenKey can tell which tokens the generator wrote in CAPS.
const normalizeName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(INTRA_WORD_HYPHEN, ' ')
    .replace(BLANK_RUN, ` ${BLANK_SENTINEL} `)
    .replace(NON_KEY_CHARS, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim()

export const canonicalize = (name: string): string => normalizeName(name).toLowerCase()

// This generator writes the mechanic's argument in CAPS ("Words after SWEET", "Words after T").
// Stopword removal would eat that argument and collapse "Words after BY", "Words after IN" and
// "Words after A" onto one key, so an all-uppercase token is never treated as a stopword. A
// single-letter token counts, which is why the check needs a cased character to be present.
const isAllCaps = (token: string): boolean => token === token.toUpperCase() && token !== token.toLowerCase()

export const tokenKey = (name: string): string | null => {
  const normalized = normalizeName(name)
  // Blank position is semantic ("___ BALL" is not "BALL ___") and a token set destroys it,
  // so these fall back to canonicalize-only matching.
  if (normalized.includes(BLANK_SENTINEL)) {
    return null
  }

  const tokens = normalized
    .split(' ')
    .filter((token) => token.length > 0 && (isAllCaps(token) || !STOPWORDS.has(token.toLowerCase())))
    .map((token) => token.toLowerCase())
  const unique = [...new Set(tokens)].sort()
  return unique.length === 0 ? null : unique.join(' ')
}
