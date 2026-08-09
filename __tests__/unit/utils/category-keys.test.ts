import { canonicalize, tokenKey } from '@utils/category-keys'

describe('category-keys', () => {
  describe('canonicalize', () => {
    it.each([
      ['Homophones of Body Parts', 'homophones of body parts'],
      ['  FIRE   ____  ', 'fire ___'],
      ['FIRE ___', 'fire ___'],
      ['Ways to denote a citation!', 'ways to denote a citation'],
      // Leading articles are retained -- stripping them merged four distinct blank categories
      ['A ___', 'a ___'],
      ['AN ___', 'an ___'],
      ['THE ___', 'the ___'],
      ['___', '___'],
      ['The Spice Girls', 'the spice girls'],
      // A hyphen inside a word separates words; it never becomes a blank
      ['Black-and-white things', 'black and white things'],
      ['Well-being words', 'well being words'],
      // Diacritics are folded, not deleted
      ['Naïve things', 'naive things'],
      ['Résumé words', 'resume words'],
      // Remaining punctuation becomes a space, not nothing
      ['Rock/pop genres', 'rock pop genres'],
      ['Words + S', 'words s'],
      ['Temperature + ___', 'temperature ___'],
    ])('should canonicalize "%s" to "%s"', (input, expected) => {
      expect(canonicalize(input)).toEqual(expected)
    })

    it.each([
      ['BALL -', 'ball ___'],
      ['BALL _', 'ball ___'],
      ['BALL --', 'ball ___'],
      ['BALL ‐', 'ball ___'],
      ['BALL ‑', 'ball ___'],
      ['BALL ‒', 'ball ___'],
      ['BALL –', 'ball ___'],
      ['BALL —', 'ball ___'],
      ['BALL ―', 'ball ___'],
      ['BALL −', 'ball ___'],
      ['BALL ＿', 'ball ___'],
      ['BALL …', 'ball ___'],
      ['BALL ...', 'ball ___'],
      ['— BALL', '___ ball'],
      ['... BALL', '___ ball'],
    ])('should normalize the blank marker in "%s" to "%s"', (input, expected) => {
      expect(canonicalize(input)).toEqual(expected)
    })

    it.each([
      // Positional categories that leading-article stripping used to merge
      ['A ___', 'THE ___'],
      ['A ___', 'AN ___'],
      ['A ___', '___'],
      ['AN ___', 'THE ___'],
      // Blank position is the whole meaning; blank-bearing names have no token key to fall back on
      ['BALL —', '— BALL'],
      ['BALL _', '_ BALL'],
      ['BALL -', '- BALL'],
      ['BALL …', '… BALL'],
      ['BALL ...', '... BALL'],
      ['BALL −', '− BALL'],
      ['BALL ＿', '＿ BALL'],
      // A plus is not a blank, a dash is
      ['Words + S', 'Words - S'],
      // Diacritic folding must not delete the letter it decorates
      ['Naïve things', 'Nave things'],
      // No stemming
      ['Blues songs', 'Blue songs'],
      ['News shows', 'New shows'],
      // The mechanic's argument distinguishes these
      ['Words after BY', 'Words after IN'],
    ])('should keep "%s" distinct from "%s"', (left, right) => {
      expect(canonicalize(left)).not.toEqual(canonicalize(right))
    })

    it.each([
      ['Homophones of Body Parts', 'homophones of body parts'],
      ['Résumé words', 'Resume words'],
      ['FIRE ____', 'FIRE ___'],
      ['  BALL   ___  ', 'ball ___'],
    ])('should match "%s" with "%s"', (left, right) => {
      expect(canonicalize(left)).toEqual(canonicalize(right))
    })
  })

  describe('tokenKey', () => {
    it.each([
      ['Homophones of body parts', 'body homophones parts'],
      // No stemming: plurals are preserved verbatim
      ['Blues songs', 'blues songs'],
      ['Blue songs', 'blue songs'],
      // An ALL-CAPS token is the mechanic's argument and survives stopword removal
      ['Words after BY', 'after by words'],
      ['Words after IN', 'after in words'],
      ['Words after A', 'a after words'],
      ['OF THE', 'of the'],
      // ...but the same words in lowercase are ordinary stopwords
      ['Words after by', 'after by words'],
      ['Words after the', 'after words'],
      // A hyphenated word splits into tokens rather than becoming a blank
      ['Black-and-white things', 'black things white'],
      // Punctuation separates tokens
      ['Rock/pop genres', 'genres pop rock'],
      // Duplicate tokens collapse and output is sorted
      ['Words about words and letters', 'about letters words'],
    ])('should build the token key for "%s" as "%s"', (input, expected) => {
      expect(tokenKey(input)).toEqual(expected)
    })

    it.each([
      ['___ BALL'],
      ['BALL ___'],
      ['FIRE ____'],
      ['BALL -'],
      ['- BALL'],
      ['BALL _'],
      ['_ BALL'],
      ['BALL —'],
      ['BALL …'],
      ['BALL ...'],
      ['Words - S'],
      ['Temperature + ___'],
    ])('should return null for "%s" because blank position is semantic', (input) => {
      expect(tokenKey(input)).toBeNull()
    })

    it('should return null when every token is a lowercase stopword', () => {
      expect(tokenKey('of the')).toBeNull()
    })

    it.each([
      // The mechanic's argument must not be eaten by the stopword list
      ['Words after BY', 'Words after IN'],
      ['Words after IN', 'Words after ON'],
      ['Words after ON', 'Words after A'],
      ['Words after A', 'Words after BY'],
      ['Words after SWEET', 'Words before SWEET'],
      // No stemming: a singular noun ending in "s" is not another word's plural
      ['Blues songs', 'Blue songs'],
      ['News shows', 'New shows'],
      ['Times headlines', 'Time headlines'],
      ['Means of transport', 'Mean of transport'],
      ['Odds ends', 'Odd ends'],
      ['Arms things', 'Arm things'],
      ['Lens parts', 'Len parts'],
      ['Species names', 'Specie names'],
      // Diacritics fold to their base letter and are not dropped
      ['Naïve things', 'Nave things'],
      // A dash is a blank (null key), a plus is not
      ['Words + S', 'Words - S'],
      ['Types of tomatoes', 'Types of potatoes'],
      ['Parts of a tooth', 'Parts of a car'],
    ])('should keep "%s" distinct from "%s"', (left, right) => {
      expect(tokenKey(left)).not.toEqual(tokenKey(right))
    })

    it.each([
      // Pure reordering still matches without a stemmer
      ['Homophones of body parts', 'Body parts homophones'],
      ['Words after SWEET', 'SWEET: words after'],
      ['Rock/pop genres', 'Rock pop genres'],
      ['Résumé words', 'Resume words'],
    ])('should match "%s" with "%s"', (left, right) => {
      expect(tokenKey(left)).toEqual(tokenKey(right))
    })
  })
})
