/*
 * Words kept out of the inspiration seed lists by build-word-lists.ts.
 *
 * BUILD-TIME ONLY. Nothing under src/handlers/ imports this, so it is never in a Lambda bundle.
 * It lives in scripts/ rather than src/assets/ because scripts/ is where its only consumers are --
 * this file and word-lists.test.ts.
 *
 * WHY THIS IS SEPARATE FROM src/assets/blocklist.ts
 *
 * blocklist.ts is the OUTPUT gate: findChargedTerm checks it against generated category names,
 * hints, and words, and a hit throws the whole game away. It is scoped to unambiguous profanity and
 * is deliberately never sent to the model, because listing slurs in a prompt primes toward the
 * neighborhood being avoided.
 *
 * This is an INPUT filter over mostly-clean English. "clitoris" and "marijuana" are not profanity;
 * they are poor seeds, because a seed steers generation.
 *
 * The two are NOT independent. A seed can be echoed verbatim into a player-visible grid, and
 * findChargedTerm matches only 21 whole tokens -- so "whorehouse" passes it even though "whore"
 * would not, and "ass" passes even though "asshole" would not. Anything reaching the model here can
 * reach a player. That is why this list has to be thorough rather than illustrative.
 *
 * SCOPE -- what this list is and is not for
 *
 * IN: explicit sexual anatomy and acts, excretion, underwear and undress, recreational drugs,
 * demonyms and ethnonyms, graphic violence, pejorative body and disability terms, lowercased proper
 * nouns, and words the source dataset labels with the wrong part of speech.
 *
 * OUT, deliberately: weapons (a "things in an armoury" category is fine), morbid but clean
 * vocabulary (coffin, corpse, hearse, wart), ordinary anatomy (armpit, nostril, thigh, elbow),
 * ordinary garments (bikini, camisole, garter, pantyhose), genericized trademarks (frisbee,
 * thermos, dumpster, escalator -- "brand names that became generic" is a good category), and
 * ambiguous words with an innocent dominant sense (weed, pot, joint, hula, steroid).
 *
 * WHY IT IS A DENYLIST, AND THEREFORE INCOMPLETE
 *
 * Concreteness ratings score these highly precisely because they name physical things, so the
 * threshold pulls them in by design. No ranking signal separates them, so the filter is a list of
 * words against open classes and cannot be exhaustive.
 *
 * word-lists.test.ts asserts none of them survive. RE-SCAN THE OUTPUT WHENEVER A THRESHOLD, A CAP,
 * OR THE SELECTION ALGORITHM CHANGES -- an earlier revision scanned, then changed the draw from a
 * top slice to a band draw, and did not re-scan; heroin, opium, and cannabis entered that way.
 */

// Demonyms, ethnonyms, and lowercased proper nouns. The dataset stores every word lowercase, so the
// /^[a-z]+$/ filter in the build script does NOT remove proper nouns -- it removes hyphenates,
// apostrophes, and digits, and nothing else. Dom_Pos labels some "Name", which the part-of-speech
// split drops, but demonyms arrive tagged Adjective and survive. This list is the only defense.
//
// One tuning change away from mattering: samurai (4.50), gypsy (4.45), ninja (4.28), polish (4.23),
// oriental (3.50) all sit just outside the current cutoffs.
const properAndEthnic = ['afghan', 'apache', 'bible', 'colored', 'fallopian', 'pygmy', 'tribesman']

const sexual = [
  'anus',
  'areola',
  'busty',
  'centerfold',
  'circumcise',
  'clitoris',
  'dildo',
  'ejaculate',
  'erect',
  'fisting',
  'flaccid',
  'fondle',
  'fornicate',
  'foreskin',
  'genital',
  'genitalia',
  'genitals',
  'gonad',
  'grope',
  'groin',
  'hymen',
  'labia',
  'masseuse',
  'masturbate',
  'nipple',
  'nipples',
  'penis',
  'pubic',
  'scrotum',
  'semen',
  'shag',
  'spank',
  'sperm',
  'sphincter',
  'stripper',
  'testicle',
  'testicles',
  'uterus',
  'vagina',
  'whorehouse',
]

const excretion = [
  'breastfeed',
  'defecate',
  'earwax',
  'faeces',
  'fecal',
  'feces',
  'lactate',
  'mucus',
  'pee',
  'phlegm',
  'piss',
  'poop',
  'pus',
  'urinate',
  'urine',
  'vomit',
  'vomiting',
]

const undress = [
  'bra',
  'braless',
  'brassiere',
  'condom',
  'diaper',
  'jockstrap',
  'lingerie',
  'loincloth',
  'naked',
  'nude',
  'panties',
  'panty',
  'tampon',
  'thong',
  'topless',
  'underpants',
  'undershirt',
  'underwear',
]

const drugs = ['cannabis', 'ganja', 'hashish', 'heroin', 'marijuana', 'meth', 'narcotics', 'opium', 'valium']

// Innocent words whose dominant association is not. pussycat is a cat and butt is the end of a
// rifle, but neither is worth handing to a generator that runs unattended every night.
const crude = ['ass', 'butt', 'buttock', 'buttocks', 'cock', 'crotch', 'pussycat', 'wiener']

// Graphic violence. Weapons themselves stay -- see SCOPE above.
const violence = ['bludgeon', 'carjack', 'crucify', 'kidnap', 'maim', 'mutilate', 'strangle', 'suffocate']

// Pejorative or outdated body and disability terms. A category built from these is demeaning
// however neutrally the model phrases it.
const demeaning = [
  'chubby',
  'dwarfish',
  'handicapped',
  'obese',
  'overweight',
  'paraplegic',
  'potbellied',
  'pudgy',
  'quadriplegic',
  'stutterer',
]

// Dom_Pos mislabels. The morphological check in build-word-lists.ts catches most Verb-tagged nouns
// (escargot, clamshell, absinthe) but not irregular past forms or compounds whose -ed/-ing form
// exists for another reason.
const notVerbs = ['longhair', 'unwound']

// Dom_Pos mislabels in the other direction, and the honest limitation: there is NO cheap
// morphological signal for adjectives. Requiring an -er/-est/-ly form or an adjectival suffix drops
// only half of these while also killing ablaze, aflame, asleep, alpine, auburn, and barefoot, and
// shrinks the pool to barely above the cap. So the adjective list is filtered by this denylist
// alone, which means it is the least reliable of the three. Comparatives are here too: they are not
// lemmas.
const notAdjectives = [
  'arachnid',
  'armrest',
  'backhand',
  'backpedal',
  'backrest',
  'billfold',
  'blinder',
  'commissary',
  'crateful',
  'crisper',
  'cupful',
  'cymbal',
  'dogsled',
  'drier',
  'euro',
  'eucalyptus',
  'fainter',
  'farmhand',
  'flatbed',
  'flowerbed',
  'forehand',
  'forkful',
  'furrier',
  'headrest',
  'hemorrhoid',
  'infomercial',
  'invertebrate',
  'lounger',
  'overhand',
  'paralegal',
  'paramedic',
  'plunger',
  'reformatory',
  'roundtable',
  'sled',
  'stagehand',
  'subtotal',
  'taller',
  'tartar',
  'vertebrate',
  'waterbed',
]

export const excludedSeeds = new Set([
  ...crude,
  ...demeaning,
  ...drugs,
  ...excretion,
  ...notAdjectives,
  ...notVerbs,
  ...properAndEthnic,
  ...sexual,
  ...undress,
  ...violence,
])
