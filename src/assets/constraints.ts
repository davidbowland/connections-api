export const specialConstraints: string[] = [
  'all words must be 4 letters, but categories must be MUST specific than "4-letter words"',
  'all words must be 5 letters, but categories must be MUST specific than "5-letter words"',
  'all words must have double letters, but categories MUST be more specific than "words with double letters" or "words that contain \"look\""',
  'all words must be compound words, but categories MUST be more specific than "words that contain \"look\"" or "compound words" (for example: "words containing animals")',
  'most words should be part of famous phrases or the title of a famous work (tv show, movie, book, etc)',
  'most words should have a Z in them, but categories MUST be more specific than "words with a Z"',
  'most words should have a Q in them, but categories MUST be more specific than "words with a Q"',
  'all words must begin with the same letter, but categories MUST be more specific than "words beginning with L". There should be one beginning letter for the game. The beginning letter should not be different in different categories.',
  'all words must end with the same letter, but categories MUST be more specific than "words ending with Y". There should be one ending letter for the game. The ending letter should not be different in different categories.',
  'all words must end in the same suffix (-ing, -er, -ly, etc), but categories MUST be more specific than "words ending with the suffix -ing". There should be one suffix for the game. The suffix should not be different in different categories.',
  'most words should rhyme with each other. There should be one rhyming sound for the game. The rhyming sound should not be different in different categories.',
  'all words must have silent letters, but categories MUST be more specific than "words with silent letters" or "words with silent B")',
  'all words must have 1 syllable, but categories MUST be more specific than "one-syllable words"',
  'all words must have 2 syllables, but categories MUST be more specific than "two-syllable words"',
  'all words must have 3 syllables, but categories MUST be more specific than "three-syllable words"',
  'all words must have 4 syllables, but categories MUST be more specific than "four-syllable words"',
  'always generate 5 categories rather than 4',
]

// Tier 1: Common patterns - good misdirection, appear frequently (weight: 3x)
const tier1Constraints: string[] = [
  'Fill in the blank pattern (e.g., "Wax ___", "Clear as ___", "___ and butter")',
  'Words that can follow a common word (e.g., "Words after T", "Words that can follow over")',
  'Words that can precede a common word (e.g., "Words before house", "Words that can precede ball")',
  'Synonyms for an action or verb (e.g., "Capture on video", "Ways to move quickly", "Ways to speak")',
  'Abstract qualities or characteristics (e.g., "Mettle", "Courage", "Deception", "Speed")',
  'Words with multiple meanings where one meaning fits a theme (e.g., "Words that can mean both a tool and an action")',
  'Things with a shared functional property (e.g., "Things that can be caught", "Things that have keys", "Things that can be broken but aren\'t physical")',
  'Associated with a specific person, real or fictional (e.g., "Associated with Freud", "Associated with Shakespeare", "Associated with Batman")',
  'Pop culture references with a modifier (e.g., "Pro wrestling icons, with The", "Rappers, without Lil", "Bands, with The")',
  'Words that are also names (e.g., "Common first names that are also nouns", "Last names that are also verbs")',
]

// Tier 2: Uncommon patterns - interesting but could become predictable (weight: 2x)
const tier2Constraints: string[] = [
  'Homophones of a category (e.g., "Homophones of body parts", "Homophones of animals", "Homophones of colors")',
  'Words that sound like something else (e.g., "Words that sound like letters", "Words that sound like numbers")',
  'Slang or colloquial terms for something (e.g., "Slang for money", "Slang for police")',
  'Words that can be verbed (e.g., "Nouns that are commonly used as verbs")',
  'Euphemisms for something (e.g., "Euphemisms for death", "Euphemisms for bathroom")',
  'Words that change meaning with stress (e.g., "Words that are nouns or verbs depending on stress")',
  'Types of a thing that have surprising secondary meanings (e.g., "Types of shoes that are also verbs", "Types of fish that are also actions")',
  'Words that can follow or precede the same word (e.g., "Words that work with \'break\'", "Words that work with \'set\'")',
  'Compound word components (e.g., "First words in compound words with \'ball\'", "Second words in compound words with \'fire\'")',
]

// Tier 3: Rare patterns - very specific, should appear infrequently (weight: 1x)
const tier3Constraints: string[] = [
  `Words containing an embedded word of at least 4 characters but aren't compound words (e.g., "Words containing RISK", "Words containing MANE")`,
  'Anagrams or letter rearrangements (e.g., "Anagrams of animals", "Anagrams of states")',
  'Words that are portmanteaus (e.g., "Blended words", "Portmanteaus in technology")',
  'Words that are both singular and plural (e.g., "Words that don\'t change in plural form")',
  'Words with silent letters in a specific position (e.g., "Words with silent letters that sound like other words")',
]

export const normalConstraints: string[] = [
  ...tier1Constraints,
  ...tier1Constraints,
  ...tier1Constraints,
  ...tier2Constraints,
  ...tier2Constraints,
  ...tier3Constraints,
]

export const fixedDateConstraints: Record<string, string> = {
  '0101':
    "all words must be related to New Year's Day, but categories are NOT required to be New Year-related",
  '0214':
    "all words must be related to Valentine's Day, but categories are NOT required to be Valentine's Day-related",
  '0401':
    "all words must be related to April Fools' Day/pranks/jokes, but categories are NOT required to be prank-related",
  '0704':
    'all words must be related to Independence Day/July 4th, but categories are NOT required to be patriotic',
  '0920':
    'all words must be related to weddings/anniversaries/love, but categories are NOT required to be patriotic',
  '1031':
    'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
  '1111':
    'all words must be related to Veterans Day/military/service, but categories are NOT required to be military-related',
  '1225':
    'all words must be related to Christmas, but categories are NOT required to be Christmas-related',
}
