// Categories the model gravitates toward repeatedly — always disallowed, even when absent from
// game history (e.g., after a reroll deletes the game that used them)
export const alwaysDisallowedCategories: string[] = [
  'Homophones of body parts',
  'Homophones of parts of the body',
  'Spice Girls',
  'Spice Girls members',
  'Spice Girls songs',
]

export const wordConstraints: string[] = [
  'all words must be 4 letters, but categories MUST be more specific than "4-letter words"',
  'all words must be 5 letters, but categories MUST be more specific than "5-letter words"',
  'all words must have double letters, but categories MUST be more specific than "words with double letters"',
  'all words must be compound words, but categories MUST be more specific than "words that contain "look"" or "compound words" (for example: "words containing animals")',
  'most words should appear in titles or famous phrases, but categories should reference the SOURCE, not just "words from titles"',
  'most words should have either a Z or a Q in them, but categories MUST be more specific than "words with a Z or Q"',
  'all words must begin with the same letter, but categories MUST be more specific than "words beginning with L". There should be one beginning letter for the game. The beginning letter should not be different in different categories.',
  'all words must end with the same letter, but categories MUST be more specific than "words ending with Y". There should be one ending letter for the game. The ending letter should not be different in different categories.',
  'all words must end in the same suffix (-ing, -er, -ly, etc), but categories MUST be more specific than "words ending with the suffix -ing". There should be one suffix for the game. The suffix should not be different in different categories.',
  'most words should rhyme with each other. There should be one rhyming sound for the game. The rhyming sound should not be different in different categories.',
  'all words must have silent letters, but categories MUST be more specific than "words with silent letters" or "words with silent B"',
  'all words must have 1 syllable, but categories MUST be more specific than "one-syllable words"',
  'all words must have 2 syllables, but categories MUST be more specific than "two-syllable words"',
  'all words must have 3 syllables, but categories MUST be more specific than "three-syllable words"',
  'all words must have 4 syllables, but categories MUST be more specific than "four-syllable words"',
  'all words must contain exactly one vowel, but categories MUST be more specific than "words with one vowel"',
  'all words must be borrowed from another language (e.g., FIESTA, KINDERGARTEN, SUSHI), but categories MUST be more specific than "loanwords"',
  'all words must also be common first names (e.g., MARK, GRACE, BILL), but categories MUST be more specific than "words that are names"',
  'all "words" must be two-word phrases (e.g., "WARM RECEPTION", "COLD SHOULDER", "HOT PURSUIT", "COOL HAND"). Within each category, the four phrases share a theme through words in one position — either all first words or all second words; the position can differ between categories. The category name describes that positional word\'s theme (e.g., "Temperature + ___" for phrases whose first word is a temperature like WARM/COLD/HOT/COOL, or "___ + Metal" for phrases whose second word is a metal)',
  'all "words" must be a two-word hyphenated phrases (e.g., "WELL-BEING", "FAR-FETCHED"). Within each category, the four phrases share a theme through words in one position — either all first words or all second words; the position can differ between categories. The category name describes that positional word\'s theme (e.g., "Temperature + ___" for phrases whose first word is a temperature like WARM/COLD/HOT/COOL, or "___ + Metal" for phrases whose second word is a metal)',
  'always generate 5 categories rather than 4',
]

// Tier 1: Common patterns - good misdirection, appear frequently (probability: 0.70)
export const tier1CategoryConstraints: string[] = [
  'Specific category of things/items — avoid pure semantic fields like "types of drinks" or "kitchen appliances"; prefer categories with lateral misdirection (e.g., "Punctuation marks", "Olympic events", "Monopoly tokens")',
  'Things sharing a property, or attributes of one specific thing (e.g., "Things that are stripy", "Things that are pink", "Foamy things", "Attributes of a frog", "Describes tires")',
  'Things found in/seen in a specific context (e.g., "Seen at airport security", "Words on Monopoly squares")',
  'Specific types within a category (e.g., "Types of tomatoes", "Basketball shots", "Action film subgenres")',
  'Parts/components of something (e.g., "Parts of a tooth", "Features of a car console")',
  'Associated with a person/character (e.g., "Associated with Poe", "PIXAR protagonists described indirectly")',
  'Pop culture with modifier (e.g., "Oscar winners", "90s action films", "Rappers without Lil")',
  'Words that plausibly fit into multiple common categories, creating maximum misdirection (e.g., words that could be colors, animals, OR verbs)',
  'Literature references, but not more than one name unless they are also common words (e.g. "The four horsemen of the apocalypse: CONQUEST, WAR, FAMINE, DEATH" or "Characters in The Canterbury Tales: MILLER, PARDONER, KNIGHT, WIFE OF BATH")',
  'History references, but not more than one name unless they are also common words (e.g. "Originated in ancient Greece: GEOMETRY, THEATER, ATOMIC THEORY, MEDICINE")',
  'Words associated with a specific sense — taste, texture, sound (e.g., "Things that are crunchy", "Words that sound soft", "Things that taste bitter")',
  'Pop culture concepts, but not more than one name unless they are also common words (e.g. "Rocky Horror Picture Show: ROCKY, HORROR, PICTURE, SHOW" or "Members of The Breakfast Club: BRAIN, ATHLETE, BASKET CASE, PRINCESS")',
]

// Tier 2: Uncommon patterns - interesting but could become predictable (probability: 0.24)
export const tier2CategoryConstraints: string[] = [
  'Synonyms for something (e.g., "Euphemisms for death", "Ways to say yes", "Slang for money")',
  'Compound word components (e.g., "First words in compounds with BALL", "Second words in compounds with FIRE")',
  'Ending/starting with [category] (e.g., "Ending in colors: INFRARED, MARIGOLD" where each color appears ONLY ONCE)',
  'Idiom/phrase components (e.g., "First word in common idioms: BREAK, BURN, BITE, BURY", "Last word in common phrases")',
  'Fill in the blank: (e.g., "BAKE A ___", "WET & ___")',
  'Words that can follow a common word (e.g., "Words after SWEET", "Words that can follow FIRE")',
  'Words that can precede a common word (e.g., "Words before HOUSE", "Words that can precede BALL")',
  'Words that become new words with a common prefix (e.g., "Words that become new words with UN___", "Add RE___ to make new words", "OUT___ words")',
  'Words that double as a different part of speech (e.g., "Nouns that are also verbs: DUCK, PARK, MATCH")',
]

// Tier 3: Rare patterns - very specific, should appear infrequently (probability: 0.06, at most one per game)
export const tier3CategoryConstraints: string[] = [
  'Homophones of a category (e.g., "Homophones of tools", "Homophones of numbers")',
  'Words spelled backwards are [category] (e.g., "Backwards animals: FLOW, GOD, TAB")',
  '[Category] plus a letter (e.g., "Organ plus letter: COLONY, HEARTH, LUNGE")',
  '[Category] minus a letter (e.g., "Metal minus a letter")',
  'Pop culture: First/second/middle/last/only word in titles (e.g., "Second words in ABBA songs", "Last words in Poe stories")',
  'Starting with synonyms for [word] (e.g., "Starting with synonyms for EAT: BOLT, CHOW, SCARF, WOLF" where each synonym appears ONLY ONCE)',
  'Ending with synonyms for [word] (e.g., "Ending with synonyms for LOCATION: PLACE, POINT, SITE, SPOT" where each synonym appears ONLY ONCE)',
  'Anagrams of [category] (e.g., "Anagrams of animals", "Anagrams of states")',
  `Words containing an embedded word of at least 4 characters but aren't compound words (e.g., "Words containing RISK", "Words containing body parts" where each body part appears ONLY ONCE)`,
  'Words that sound like [specific pattern] (e.g., "Sound like letter + word combination")',
  'Portmanteau components (e.g., "First halves of portmanteaus: BREAK in BREAKFAST, MOTOR in MOTEL")',
  'Eponyms — common words derived from real people\'s names, grouped by domain (e.g., "Named after military figures: CARDIGAN, SHRAPNEL, WELLINGTON, BOWIE" or "Named after scientists: WATT, FAHRENHEIT, DIESEL, BUNSEN"). Always pick a consistent domain — never mix domains in one category.',
]

// Occupies a single slot and asks the model to invent a pattern the tier lists do not cover.
// Scoped to "the other constraints in this list" rather than an open-ended novelty check: the model
// also receives 500+ disallowedCategories, and an unbounded "is this a close variant of anything?"
// check is a search with no terminating state -- which is how this slot exhausted its token budget.
// The disallowed list is already enforced by the prompt itself, so it is not re-litigated here.
export const wildcardConstraint =
  'Invent a category pattern of your own instead of reaching for a familiar one. It must not restate any of the other constraints in this list. Describe the pattern plainly in the category name, and choose words that could plausibly belong to another category in this game.'

// Appended to the pattern shared by the two twin slots. Two categories on one pattern force the
// solver to separate instances rather than spot the pattern once and be done.
export const twinSuffix =
  ' — TWIN: another category in this game uses this same pattern. Use a DIFFERENT instance of it, and choose words that could plausibly belong to either instance.'

// Stacked onto one already-drawn slot: three misdirection amplifiers and one tell-removal entry
// (the last). Do not read that as a quota to top back up, and do not add variety entries here --
// variety is the wildcard slot's job and the tier draw's. This list exists to make a grid harder to
// read, not more varied.
//
// The rule every entry obeys: a modifier may add WRONG groupings, never a second right one. Any
// property a modifier imposes POSITIVELY must be visible on words OUTSIDE this category too, or must
// point one word AT another category. A property holding for exactly these four words is a second
// answer key, however clever it is: the solver scans the grid for it, finds exactly those four, and
// is done. The tell-removal entry imposes no positive property, so it passes trivially.
//
// This is why wordConstraints may say "all words must have double letters" and a modifier may not.
// wordConstraints applies to all 16 words, where the trait has no discriminating power. Applied to 4,
// the identical trait IS the answer. Three entries were dropped for failing that test: also a common
// verb, also a proper noun, shares one unrelated surface property. Two more passed it and were
// dropped anyway -- narrow to a decade, place, or named source, a restatement of
// create-connections-game.txt:23,29; and invert the pattern, whose "build the category around what
// fails to fit it" asks for a pattern's complement. For most tier patterns that complement is
// unbounded ("words that do NOT follow SWEET"), leaving a category with no unique answer set.
export const constraintModifiers: string[] = [
  'Additionally, one word that belongs to a DIFFERENT category in this game must also be a genuine fit for this category, so a solver who spots this group sees five candidates and has to drop one. The fifth fit must be real, not a stretch — and that word must still belong more firmly to its own category.',
  'Additionally, three of these four words must also fit one obvious, well-known grouping that is NOT a category in this game, and a word from a DIFFERENT category must fit that false grouping too — so a solver who spots it can assemble four words and be wrong. That outside word must still belong more firmly to its own category. Never list this false grouping as a decoy.',
  'Additionally, choose words for this category so that at least two of them would also look at home in one of the other categories in this game. The second reading must be real, not a stretch.',
  'Additionally, the four words must not look like a set on the surface — vary whatever this pattern leaves free (length, part of speech, register) so that nothing but the category itself groups them.',
]

export interface TierDefinition {
  constraints: string[]
  probability: number
  tier: 1 | 2 | 3
}

// Probability is per-tier, not per-entry. Adding a new tier-3 pattern therefore makes that
// pattern more likely without making rare patterns collectively more common.
// Tier 3 at 0.06 puts a rare pattern in roughly 22% of four-slot games (1 - 0.94^4).
export const categoryConstraintTiers: TierDefinition[] = [
  { constraints: tier1CategoryConstraints, probability: 0.7, tier: 1 },
  { constraints: tier2CategoryConstraints, probability: 0.24, tier: 2 },
  { constraints: tier3CategoryConstraints, probability: 0.06, tier: 3 },
]

export const fixedDateCategoryConstraints: Record<string, string> = {
  '0101': "all words must be related to New Year's Day, but categories are NOT required to be New Year-related",
  '0202':
    'all words must be related to Groundhog Day/weather predictions/repetition, but categories are NOT required to be weather-related',
  '0214': "all words must be related to Valentine's Day, but categories are NOT required to be Valentine's Day-related",
  '0314': 'all words must be related to Pi Day/math/circles/pies, but categories are NOT required to be math-related',
  '0317':
    "all words must be related to St. Patrick's Day/Ireland/luck/green, but categories are NOT required to be Irish-related",
  '0401':
    "all words must be related to April Fools' Day/pranks/jokes, but categories are NOT required to be prank-related",
  '0415':
    'all words must be related to Tax Day/money/forms/deadlines/numbers, but categories are NOT required to be tax-related',
  '0422':
    'all words must be related to Earth Day/nature/environment/conservation, but categories are NOT required to be environment-related',
  '0704': 'all words must be related to Independence Day/July 4th, but categories are NOT required to be patriotic',
  // Author's wedding anniversary
  '0920':
    'all words must be related to weddings/anniversaries/love, but categories are NOT required to be wedding-related',
  '1031': 'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
  '1111':
    'all words must be related to Veterans Day/military/service, but categories are NOT required to be military-related',
  '1225': 'all words must be related to Christmas, but categories are NOT required to be Christmas-related',
}
