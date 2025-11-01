export const constraints: string[] = [
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

export const fixedDateConstraints: Record<string, string> = {
  '0101': "all words must be related to New Year's Day, but categories are NOT required to be New Year-related",
  '0214': "all words must be related to Valentine's Day, but categories are NOT required to be Valentine's Day-related",
  '0401':
    "all words must be related to April Fools' Day/pranks/jokes, but categories are NOT required to be prank-related",
  '0704': 'all words must be related to Independence Day/July 4th, but categories are NOT required to be patriotic',
  '0920': 'all words must be related to weddings/anniversaries/love, but categories are NOT required to be patriotic',
  '1031': 'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
  '1111':
    'all words must be related to Veterans Day/military/service, but categories are NOT required to be military-related',
  '1225': 'all words must be related to Christmas, but categories are NOT required to be Christmas-related',
}
