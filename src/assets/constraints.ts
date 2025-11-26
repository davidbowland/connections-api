export const wordConstraints: string[] = [
  'all words must be 4 letters, but categories must be MUST specific than "4-letter words"',
  'all words must be 5 letters, but categories must be MUST specific than "5-letter words"',
  'all words must have double letters, but categories MUST be more specific than "words with double letters" or "words that contain \"look\""',
  'all words must be compound words, but categories MUST be more specific than "words that contain \"look\"" or "compound words" (for example: "words containing animals")',
  'most words should appear in titles or famous phrases, but categories should reference the SOURCE, not just "words from titles"',
  'most words should have either a Z or a Q in them, but categories MUST be more specific than "words with a Z"',
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
const tier1CategoryConstraints: string[] = [
  'Fill in the blank: "___ [word]" or "[word] ___" (e.g., "___-DOKE", "BIG ___")',
  'Words that can follow a common word (e.g., "Words after SWEET", "Words that can follow FIRE")',
  'Words that can precede a common word (e.g., "Words before HOUSE", "Words that can precede BALL")',
  'Synonyms for a specific concept (e.g., "Synonyms for evaluate", "Ways to adhere", "Types of sailors")',
  'Specific category of things/items (e.g., "Punctuation marks", "Kitchen appliances", "Cocktails")',
  'Things with a shared property (e.g., "Things that are stripy", "Things that are pink", "Foamy things")',
  'Things found in/seen in a specific context (e.g., "Seen at airport security", "Words on Monopoly squares")',
  'Associated with a person/character (e.g., "Associated with Poe", "PIXAR protagonists described indirectly")',
  'Pop culture with modifier (e.g., "Oscar winners", "90s action films", "Rappers without Lil")',
  'Specific types within a category (e.g., "Types of tomatoes", "Basketball shots", "Action film subgenres")',
]

// Tier 2: Uncommon patterns - interesting but could become predictable (weight: 2x)
const tier2CategoryConstraints: string[] = [
  'Homophones of a category (e.g., "Homophones of body parts", "Homophones of tools")',
  'Words that sound like letter combinations (e.g., "Words that sound like two letters: NE, SA")',
  'Slang or colloquial terms (e.g., "Slang for money", "Nicknames for women", "Slang for sailor")',
  'Euphemisms for something (e.g., "Euphemisms for death", "Ways to say yes")',
  'Compound word components (e.g., "First words in compounds with BALL", "Second words in compounds with FIRE")',
  'Pop culture: First/second/middle/last word in titles (e.g., "Second words in ABBA songs", "Last words in Poe stories")',
  'Parts/components of something (e.g., "Parts of a tooth", "Features of a car console")',
]

// Tier 3: Rare patterns - very specific, should appear infrequently (weight: 1x)
const tier3CategoryConstraints: string[] = [
  'Starting with synonyms for [word] (e.g., "Starting with synonyms for EAT: BOLT, CHOW, SCARF, WOLF" where each synonym appears ONLY ONCE)',
  'Ending with synonyms for [word] (e.g., "Ending with synonyms for LOCATION: PLACE, POINT, SITE, SPOT" where each synonym appears ONLY ONCE)',
  'Ending/starting with [category] (e.g., "Ending in colors: INFRARED, MARIGOLD" where each color appears ONLY ONCE)',
  'Words spelled backwards are [category] (e.g., "Backwards animals: FLOW, GOD, TAB")',
  '[Category] plus a letter (e.g., "Organ plus letter: COLONY, HEARTH, LUNGE")',
  '[Category] minus a letter (e.g., "Metal minus a letter")',
  'Anagrams of [category] (e.g., "Anagrams of animals", "Anagrams of states")',
  `Words containing an embedded word of at least 4 characters but aren't compound words (e.g., "Words containing RISK", "Words containing body parts" where each body part apepars ONLY ONCE)`,
  'Words that sound like [specific pattern] (e.g., "Sound like letter + word combination")',
  'Portmanteaus or blended words related to [topic]',
  'Words with specific letter patterns (e.g., "Words where middle letters spell X")',
]

export const categoryConstraints: string[] = [
  ...tier1CategoryConstraints,
  ...tier1CategoryConstraints,
  ...tier1CategoryConstraints,
  ...tier2CategoryConstraints,
  ...tier2CategoryConstraints,
  ...tier3CategoryConstraints,
]

export const fixedDateCategoryConstraints: Record<string, string> = {
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
