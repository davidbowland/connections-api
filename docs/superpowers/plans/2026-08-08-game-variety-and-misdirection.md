# Game Variety and Misdirection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repetitive, easily-guessable generated Connections categories by reworking constraint selection, rejecting repeats and charged words in code, and forcing the model to commit to cross-category misdirection.

**Architecture:** Constraint selection moves from array-repetition weighting to an explicit per-tier probability draw with a rare-pattern cap and three optional special slots (wildcard, twin-mechanic, modifier). Repeat and charged-word rejection become deterministic code-level checks in `validateGame`, so the model-visible ban list can shrink. A `decoys` field on the generation tool forces the model to name cross-category traps before submitting; it is validated at generation time and then discarded rather than persisted.

**Tech Stack:** TypeScript, AWS Lambda, AWS SAM, DynamoDB, Bedrock (Claude Opus 5), Jest.

**Spec:** `docs/superpowers/specs/2026-08-08-game-variety-and-misdirection-design.md`

## Global Constraints

- Jest clears all mocks automatically (`clearMocks: true`). Never manually clear mocks.
- Shared mock defaults go in `beforeAll`. Per-test overrides use `mockReturnValueOnce` / `mockResolvedValueOnce` / `mockRejectedValueOnce`. **Never use `beforeEach`.**
- **No `if` statements in test bodies.** No live `Date.now()` or `Math.random()` in tests.
- Any function whose output depends on randomness must accept an injectable parameter with a default: `(input, random = Math.random)`.
- Source files use **relative imports** (`../assets/constraints`). Test files use **path aliases** (`@assets/`, `@services/`, `@utils/`, `@config`, `@types`) — these are Jest `moduleNameMapper` entries only, not tsconfig paths.
- Validate all external inputs at API boundaries before passing downstream. LLM output is untrusted; parse and validate against the expected schema.
- `npm run lint` (prettier + eslint) runs on commit via lint-staged. `npm test` and `npm run typecheck` must pass.
- Prompt files live in `prompts/` but are served from DynamoDB. Prompt changes require `npm run deploy-prompts` and do **not** ship with a normal deploy.
- Object keys are sorted alphabetically throughout this codebase (enforced by eslint `sort-keys`). Match it.

---

## File Structure

**Create:**
- `src/utils/category-keys.ts` — pure string functions producing repeat-detection keys.
- `src/assets/blocklist.ts` — charged-word data.
- `src/utils/constraint-selection.ts` — weighted tier draw, tier-3 cap, special slots.
- `__tests__/unit/utils/category-keys.test.ts`
- `__tests__/unit/utils/constraint-selection.test.ts`

**Modify:**
- `src/assets/constraints.ts` — replace the repeated-array export with tier definitions; add wildcard and modifier text.
- `src/config.ts` — four new environment-backed values.
- `src/services/games.ts` — selection wiring, repeat/charged/decoy validation, bounded ban list, decoy stripping.
- `src/services/verification.ts` — pass decoys to the verifier as read-only context.
- `src/types.ts` — `Decoy`, `CategoryHistory`.
- `template.yaml` — four new environment variables on `CreateGameFunction`.
- `jest.setup-test-env.js` — the same four for tests.
- `prompts/create-connections-game.txt` — same-pattern rule, slot instructions, decoy instructions.
- `prompts/verify-connections-game.txt` — decoy audit check.
- `__tests__/unit/services/games.test.ts` — extend.
- `__tests__/unit/services/verification.test.ts` — extend.

---

### Task 1: Category repeat keys

Pure string functions. No dependencies on anything else in the plan.

**Files:**
- Create: `src/utils/category-keys.ts`
- Test: `__tests__/unit/utils/category-keys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canonicalize(name: string): string`, `tokenKey(name: string): string | null`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/utils/category-keys.test.ts`:

```typescript
import { canonicalize, tokenKey } from '@utils/category-keys'

describe('category-keys', () => {
  describe('canonicalize', () => {
    it.each([
      ['Homophones of Body Parts', 'homophones of body parts'],
      ['  FIRE   ____  ', 'fire ___'],
      ['FIRE ___', 'fire ___'],
      ['Black-and-white things', 'black and white things'],
      ['The Spice Girls', 'spice girls'],
      ["Ways to denote a citation!", 'ways to denote a citation'],
    ])('should canonicalize %s to %s', (input, expected) => {
      expect(canonicalize(input)).toEqual(expected)
    })

    it('should treat en-dash and em-dash runs as blanks', () => {
      expect(canonicalize('BALL ––')).toEqual('ball ___')
    })
  })

  describe('tokenKey', () => {
    it('should produce identical keys for reordered paraphrases', () => {
      expect(tokenKey('Homophones of body parts')).toEqual(tokenKey('Body part homophones'))
    })

    it('should produce a sorted stemmed key', () => {
      expect(tokenKey('Homophones of body parts')).toEqual('body homophone part')
    })

    it.each([
      ['___ BALL'],
      ['BALL ___'],
      ['FIRE ____'],
    ])('should return null for %s because blanks are positional', (input) => {
      expect(tokenKey(input)).toBeNull()
    })

    it.each([
      ['Words after SWEET', 'Words before SWEET'],
      ['Types of tomatoes', 'Types of potatoes'],
      ['Parts of a tooth', 'Parts of a car'],
    ])('should not collide %s with %s', (left, right) => {
      expect(tokenKey(left)).not.toEqual(tokenKey(right))
    })

    it('should return null when every token is a stopword', () => {
      expect(tokenKey('of the')).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/utils/category-keys.test.ts`
Expected: FAIL — cannot find module `@utils/category-keys`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/category-keys.ts`:

```typescript
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

const BLANK_RUN = /[_–—-]{2,}/g
const SINGLE_DASH = /[-–—]/g
const NON_KEY_CHARS = /[^a-z0-9_\s]/g
const LEADING_ARTICLE = /^(?:a|an|the) /

export const canonicalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(BLANK_RUN, ' ___ ')
    .replace(SINGLE_DASH, ' ')
    .replace(NON_KEY_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_ARTICLE, '')

// Deliberately crude: consistency between the two strings being compared matters more than
// linguistic correctness, since both sides get the same treatment.
const stem = (word: string): string => {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

export const tokenKey = (name: string): string | null => {
  const canonical = canonicalize(name)
  // Blank position is semantic ("___ BALL" is not "BALL ___") and a token set destroys it,
  // so these fall back to canonicalize-only matching.
  if (canonical.includes('___')) {
    return null
  }

  const tokens = canonical
    .split(' ')
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map(stem)
  const unique = [...new Set(tokens)].sort()
  return unique.length === 0 ? null : unique.join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/unit/utils/category-keys.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/utils/category-keys.ts __tests__/unit/utils/category-keys.test.ts
git commit -m "Add canonical and token keys for category repeat detection"
```

---

### Task 2: Charged-word blocklist

**Files:**
- Create: `src/assets/blocklist.ts`
- Modify: `src/services/games.ts`
- Test: `__tests__/unit/services/games.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `chargedWords: Set<string>` (uppercase); `findChargedTerm(categories: CategoryObject): string | undefined` exported from `src/services/games.ts`.

**Important:** match whole tokens, never substrings. Substring matching produces the Scunthorpe problem — `ASSESS` contains `ASS`, `COCKTAIL` contains `COCK`, and both are legitimate puzzle words.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('createGame', ...)` block in `__tests__/unit/services/games.test.ts`:

```typescript
    it('should throw when a category word is a charged term', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['DAMN', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Generated a charged term')
    })

    it('should throw when a category name contains a charged term', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          'Damn good things': { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Generated a charged term')
    })

    it('should not reject words that merely contain a charged term as a substring', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['ASSESS', 'COCKTAIL', 'SCUNTHORPE', 'CLASSIC'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).resolves.toBeDefined()
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/games.test.ts -t 'charged'`
Expected: FAIL — the first two resolve instead of throwing.

- [ ] **Step 3: Create the blocklist**

Create `src/assets/blocklist.ts`:

```typescript
// Charged terms rejected in code rather than in the prompt. Deliberately NOT sent to the model:
// listing slurs in a generation prompt primes toward the semantic neighborhood being avoided.
// The prompt keeps its soft "no offensive or indecent words" instruction; this is the hard gate.
//
// Matching is whole-token and case-insensitive. Never substring-match — ASSESS, COCKTAIL, and
// SCUNTHORPE are legitimate puzzle words.
//
// Seeded with unambiguous profanity. Extend from a curated source as needed; entries must be
// single uppercase tokens.
export const chargedWords: Set<string> = new Set([
  'ARSE',
  'ARSEHOLE',
  'ASS',
  'ASSHOLE',
  'BASTARD',
  'BITCH',
  'BOLLOCKS',
  'COCK',
  'CRAP',
  'CUNT',
  'DAMN',
  'DICK',
  'DOUCHE',
  'DYKE',
  'FAG',
  'FAGGOT',
  'FUCK',
  'GODDAMN',
  'JIZZ',
  'NIGGER',
  'PISS',
  'PRICK',
  'PUSSY',
  'RETARD',
  'SHIT',
  'SLUT',
  'SPIC',
  'TITS',
  'TRANNY',
  'TWAT',
  'WANKER',
  'WHORE',
])
```

- [ ] **Step 4: Wire it into `validateGame`**

In `src/services/games.ts`, add the import alongside the existing asset imports:

```typescript
import { chargedWords } from '../assets/blocklist'
```

Add above `validateGame`:

```typescript
const TOKEN_SPLIT = /[^A-Z0-9]+/

const tokenize = (value: string): string[] => value.toUpperCase().split(TOKEN_SPLIT).filter(Boolean)

export const findChargedTerm = (categories: CategoryObject): string | undefined => {
  const candidates = Object.entries(categories).flatMap(([name, category]) => [name, ...category.words])
  return candidates.flatMap(tokenize).find((token) => chargedWords.has(token))
}
```

Inside `validateGame`, after the embedded-substrings branch and before `return wordList`:

```typescript
  const chargedTerm = findChargedTerm(categories)
  if (chargedTerm) {
    log('Generated a charged term', { chargedTerm })
    throw new Error(`Generated a charged term: ${chargedTerm}`)
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/unit/services/games.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/assets/blocklist.ts src/services/games.ts __tests__/unit/services/games.test.ts
git commit -m "Reject charged terms in validateGame"
```

---

### Task 3: Repeat rejection and bounded ban list

**Files:**
- Modify: `src/types.ts`, `src/config.ts`, `src/services/games.ts`, `template.yaml`, `jest.setup-test-env.js`
- Test: `__tests__/unit/services/games.test.ts`

**Interfaces:**
- Consumes: `canonicalize`, `tokenKey` from Task 1.
- Produces: `CategoryHistory` in `src/types.ts`; `buildCategoryHistory(names: string[]): CategoryHistory` and `validateGame(categories: CategoryObject, history?: CategoryHistory): string[]` from `src/services/games.ts`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('createGame', ...)`:

```typescript
    it('should throw when a generated category repeats one from history', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce({
        '2024-12-31': {
          categories: {
            'Boast!': { hint: 'hint', words: ['A', 'B', 'C', 'D'] },
          },
          wordList: [],
        },
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Generated a repeated category')
    })

    it('should throw when a generated category is a reordered paraphrase of one from history', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce({
        '2024-12-31': {
          categories: {
            'Citation denotation ways': { hint: 'hint', words: ['A', 'B', 'C', 'D'] },
          },
          wordList: [],
        },
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Generated a repeated category')
    })

    it('should cap the model-visible disallowed categories while still rejecting older repeats', async () => {
      const olderGames = Object.fromEntries(
        Array.from({ length: 600 }, (_, index) => [
          `2023-01-${index}`,
          {
            categories: { [`Historical category ${index}`]: { hint: 'hint', words: ['A', 'B', 'C', 'D'] } },
            wordList: [],
          },
        ]),
      )
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(olderGames)

      await createGame('2025-01-01', mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.disallowedCategories.length).toEqual(
        alwaysDisallowedCategories.length + disallowedCategoryLimit,
      )
    })
```

Add to the imports at the top of the file:

```typescript
import { disallowedCategoryLimit } from '@config'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/games.test.ts -t 'repeat'`
Expected: FAIL — no such export `disallowedCategoryLimit`, and the games resolve instead of throwing.

- [ ] **Step 3: Add the type**

In `src/types.ts`, under the `// Games` area (after `CategoryObject`):

```typescript
export interface CategoryHistory {
  canonical: Set<string>
  token: Set<string>
}
```

- [ ] **Step 4: Add the config value**

In `src/config.ts`, in the `// Games` block (keep alphabetical order):

```typescript
export const disallowedCategoryLimit = parseInt(process.env.DISALLOWED_CATEGORY_LIMIT as string, 10)
```

In `template.yaml`, in the `CreateGameFunction` `Environment.Variables` block (alphabetical, before `DYNAMODB_GAMES_TABLE_NAME`):

```yaml
          DISALLOWED_CATEGORY_LIMIT: 500
```

In `jest.setup-test-env.js`, in the `// Games` block:

```javascript
process.env.DISALLOWED_CATEGORY_LIMIT = '500'
```

- [ ] **Step 5: Implement in `src/services/games.ts`**

Add imports:

```typescript
import { canonicalize, tokenKey } from '../utils/category-keys'
```

and add `disallowedCategoryLimit` to the existing `../config` import list.

Add `CategoryHistory` to the existing `../types` import list.

Add above `validateGame`:

```typescript
export const buildCategoryHistory = (names: string[]): CategoryHistory => ({
  canonical: new Set(names.map(canonicalize)),
  token: new Set(names.map(tokenKey).filter((key): key is string => key !== null)),
})

const findRepeatedCategory = (categories: CategoryObject, history: CategoryHistory): string | undefined =>
  Object.keys(categories).find((name) => {
    const token = tokenKey(name)
    return history.canonical.has(canonicalize(name)) || (token !== null && history.token.has(token))
  })
```

Change the `validateGame` signature and add the check just before `return wordList`:

```typescript
export const validateGame = (categories: CategoryObject, history?: CategoryHistory): string[] => {
```

```typescript
  const repeated = history && findRepeatedCategory(categories, history)
  if (repeated) {
    log('Generated a repeated category', { repeated })
    throw new Error(`Generated a repeated category: ${repeated}`)
  }
```

Replace the opening of `createGame` (currently `src/services/games.ts:169-175`):

```typescript
export const createGame = async (gameId: GameId, random = Math.random): Promise<ConnectionsData> => {
  const pastGames = await getAllGames()
  // GameIds are ISO dates, so a descending string sort is newest-first.
  const pastCategories = Object.entries(pastGames)
    .sort(([left], [right]) => right.localeCompare(left))
    .flatMap(([, game]) => Object.keys(game.categories))
  const disallowedCategories = [
    ...alwaysDisallowedCategories,
    ...pastCategories.slice(0, disallowedCategoryLimit),
  ]
  // The code-level history covers the FULL archive, not just the model-visible window.
  const categoryHistory = buildCategoryHistory([...alwaysDisallowedCategories, ...pastCategories])
  const modelContext = getModelContext(new Date(gameId), disallowedCategories, random)
```

Pass the history to both `validateGame` calls:

```typescript
  validateGame(connectionsData.categories, categoryHistory)

  const verifiedGame = await verifyAndFixGame(connectionsData, modelContext)
  const finalWordList = validateGame(verifiedGame.categories, categoryHistory)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/unit/services/games.test.ts`
Expected: PASS. The pre-existing history test still passes because 500 exceeds its two categories.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/types.ts src/config.ts src/services/games.ts template.yaml jest.setup-test-env.js __tests__/unit/services/games.test.ts
git commit -m "Reject repeated categories in code and bound the model-visible ban list"
```

---

### Task 4: Weighted tier draw with a rare-pattern cap

**Files:**
- Modify: `src/assets/constraints.ts`
- Create: `src/utils/constraint-selection.ts`, `__tests__/unit/utils/constraint-selection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TierDefinition` and `categoryConstraintTiers` from `src/assets/constraints.ts`; `drawConstraints(count: number, random: () => number): DrawnConstraint[]` from `src/utils/constraint-selection.ts`, where `DrawnConstraint` is `{ constraint: string; tier: 1 | 2 | 3 }`.

**Why per-tier probability rather than per-entry weight:** the current array-repetition scheme means adding a new tier-3 pattern makes tier-3 collectively *more* frequent. Fixing the probability per tier decouples the two.

Target: tier 3 in ~20% of games. `1 - (1 - 0.06)^4 ≈ 0.22`, versus ~49% today.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/utils/constraint-selection.test.ts`:

```typescript
import { tier1CategoryConstraints, tier2CategoryConstraints, tier3CategoryConstraints } from '@assets/constraints'
import { drawConstraints } from '@utils/constraint-selection'

describe('constraint-selection', () => {
  describe('drawConstraints', () => {
    it('should draw the requested number of constraints', () => {
      const random = jest.fn().mockReturnValue(0)

      expect(drawConstraints(4, random)).toHaveLength(4)
    })

    it('should draw from tier 1 for a low tier roll', () => {
      const random = jest.fn().mockReturnValue(0)

      expect(drawConstraints(1, random)).toEqual([{ constraint: tier1CategoryConstraints[0], tier: 1 }])
    })

    it('should draw from tier 2 for a mid tier roll', () => {
      // 0.8 of the 1.0 total lands past tier 1 (0.70) and inside tier 2 (0.24).
      const random = jest.fn().mockReturnValueOnce(0.8).mockReturnValue(0)

      expect(drawConstraints(1, random)).toEqual([{ constraint: tier2CategoryConstraints[0], tier: 2 }])
    })

    it('should draw from tier 3 for a high tier roll', () => {
      const random = jest.fn().mockReturnValueOnce(0.99).mockReturnValue(0)

      expect(drawConstraints(1, random)).toEqual([{ constraint: tier3CategoryConstraints[0], tier: 3 }])
    })

    it('should never draw more than one tier 3 constraint', () => {
      const random = jest.fn().mockReturnValue(0.99)

      const drawn = drawConstraints(4, random)

      expect(drawn.filter(({ tier }) => tier === 3)).toHaveLength(1)
    })

    it('should fall back to tier 2 once tier 3 is exhausted', () => {
      const random = jest.fn().mockReturnValue(0.99)

      const drawn = drawConstraints(4, random)

      expect(drawn.map(({ tier }) => tier)).toEqual([3, 2, 2, 2])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/utils/constraint-selection.test.ts`
Expected: FAIL — cannot find module `@utils/constraint-selection`; `tier1CategoryConstraints` is not exported.

- [ ] **Step 3: Restructure `src/assets/constraints.ts`**

Change the three tier arrays from `const` to `export const` (they are currently module-private at lines 36, 52, and 65).

Delete the `categoryConstraints` export (currently lines 80-88) and replace it with:

```typescript
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
```

- [ ] **Step 4: Create `src/utils/constraint-selection.ts`**

```typescript
import { categoryConstraintTiers, TierDefinition } from '../assets/constraints'

export interface DrawnConstraint {
  constraint: string
  tier: 1 | 2 | 3
}

const pickTier = (tiers: TierDefinition[], roll: number): TierDefinition => {
  const total = tiers.reduce((sum, tier) => sum + tier.probability, 0)
  let remaining = roll * total
  for (const tier of tiers) {
    remaining -= tier.probability
    if (remaining < 0) {
      return tier
    }
  }
  return tiers[tiers.length - 1]
}

// Consumes exactly two random values per slot, so callers can reason about the sequence.
export const drawConstraints = (count: number, random: () => number): DrawnConstraint[] => {
  const drawn: DrawnConstraint[] = []
  let tierThreeUsed = false

  while (drawn.length < count) {
    const available = tierThreeUsed
      ? categoryConstraintTiers.filter(({ tier }) => tier !== 3)
      : categoryConstraintTiers
    const tier = pickTier(available, random())
    const constraint = tier.constraints[Math.floor(random() * tier.constraints.length)]
    tierThreeUsed = tierThreeUsed || tier.tier === 3
    drawn.push({ constraint, tier: tier.tier })
  }

  return drawn
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/unit/utils/constraint-selection.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: FAIL in `src/services/games.ts` — it still imports the deleted `categoryConstraints`. That is resolved in Task 6. To keep this task independently committable, leave the import in place but stop it breaking the build by temporarily keeping a compatibility export in `src/assets/constraints.ts`:

```typescript
// Removed in Task 6 once getModelContext uses the weighted draw.
export const categoryConstraints: string[] = [
  ...tier1CategoryConstraints,
  ...tier2CategoryConstraints,
  ...tier3CategoryConstraints,
]
```

Re-run `npm run typecheck` and `npm test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/assets/constraints.ts src/utils/constraint-selection.ts __tests__/unit/utils/constraint-selection.test.ts
git commit -m "Add weighted tier draw with a one-per-game cap on rare patterns"
```

---

### Task 5: Wildcard, twin, and modifier slots

**Files:**
- Modify: `src/assets/constraints.ts`, `src/utils/constraint-selection.ts`, `src/config.ts`, `template.yaml`, `jest.setup-test-env.js`
- Test: `__tests__/unit/utils/constraint-selection.test.ts`

**Interfaces:**
- Consumes: `drawConstraints`, `DrawnConstraint` from Task 4.
- Produces: `selectCategoryConstraints(count: number, random: () => number): string[]` from `src/utils/constraint-selection.ts`.

**Random consumption order — all five special rolls are consumed unconditionally and up front, before any slot draw, so the sequence a test supplies stays stable regardless of which branch is taken:**

1. wildcard roll
2. twin roll
3. modifier roll
4. modifier slot-index roll
5. modifier choice roll
6. then two rolls per drawn slot (Task 4)

- [ ] **Step 1: Write the failing test**

Append inside `describe('constraint-selection', ...)`:

```typescript
  describe('selectCategoryConstraints', () => {
    // Rolls: wildcard, twin, modifier, modifier index, modifier choice, then 2 per drawn slot.
    const noSpecials = (slotRolls: number[] = []) =>
      jest.fn(mockSequence([0.99, 0.99, 0.99, 0, 0, ...slotRolls]))

    it('should return one constraint per slot', () => {
      expect(selectCategoryConstraints(4, noSpecials())).toHaveLength(4)
    })

    it('should insert a wildcard slot when the wildcard roll hits', () => {
      const random = jest.fn(mockSequence([0, 0.99, 0.99, 0, 0]))

      expect(selectCategoryConstraints(4, random)[0]).toEqual(wildcardConstraint)
    })

    it('should not use a twin slot when the wildcard slot fired', () => {
      const random = jest.fn(mockSequence([0, 0, 0.99, 0, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected.filter((entry) => entry.includes('TWIN'))).toHaveLength(0)
    })

    it('should produce two twin slots on the same tier 2 pattern when the twin roll hits', () => {
      const random = jest.fn(mockSequence([0.99, 0, 0.99, 0, 0]))

      const selected = selectCategoryConstraints(4, random)
      const twins = selected.filter((entry) => entry.includes('TWIN'))

      expect(twins).toHaveLength(2)
      expect(twins[0]).toEqual(twins[1])
      expect(twins[0]).toContain(tier2CategoryConstraints[0])
    })

    it('should apply a modifier when the modifier roll hits', () => {
      const random = jest.fn(mockSequence([0.99, 0.99, 0, 0, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected.filter((entry) => entry.includes(constraintModifiers[0]))).toHaveLength(1)
    })

    it('should never apply a modifier to the wildcard slot', () => {
      const random = jest.fn(mockSequence([0, 0.99, 0, 0, 0]))

      expect(selectCategoryConstraints(4, random)[0]).toEqual(wildcardConstraint)
    })
  })
```

Add at the top of the file, above `describe`:

```typescript
const mockSequence = (values: number[]) => {
  let index = 0
  return () => {
    const value = values[index] ?? 0
    index += 1
    return value
  }
}
```

Extend the imports:

```typescript
import {
  constraintModifiers,
  tier1CategoryConstraints,
  tier2CategoryConstraints,
  tier3CategoryConstraints,
  wildcardConstraint,
} from '@assets/constraints'
import { drawConstraints, selectCategoryConstraints } from '@utils/constraint-selection'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/utils/constraint-selection.test.ts`
Expected: FAIL — `selectCategoryConstraints`, `wildcardConstraint`, and `constraintModifiers` are not exported.

- [ ] **Step 3: Add the new constraint text**

Append to `src/assets/constraints.ts`:

```typescript
export const wildcardConstraint =
  'Invent a category pattern that does not appear elsewhere in this list and is not a close variant of one. Describe the pattern plainly in the category name.'

export const twinSuffix =
  ' — TWIN: another category in this game uses this same pattern. Use a DIFFERENT instance of it, and choose words that could plausibly belong to either instance.'

export const constraintModifiers: string[] = [
  'Additionally, every word in this category must also be a common verb.',
  'Additionally, narrow this category to a single specific decade, place, or named source.',
  'Additionally, invert the usual form of this pattern — build the category around what fails to fit it.',
  'Additionally, every word in this category must also share one unrelated surface property (all compound words, all two syllables, all containing a double letter).',
  'Additionally, combine this pattern with a second unrelated pattern so that each word satisfies both at once.',
  'Additionally, restrict this category to words that are also proper nouns in a different context.',
]
```

- [ ] **Step 4: Add the config values**

In `src/config.ts`, `// Games` block (alphabetical):

```typescript
export const modifierChance = Number(process.env.MODIFIER_CHANCE as string)
export const twinMechanicChance = Number(process.env.TWIN_MECHANIC_CHANCE as string)
export const wildcardSlotChance = Number(process.env.WILDCARD_SLOT_CHANCE as string)
```

In `template.yaml`, `CreateGameFunction` `Environment.Variables` (alphabetical):

```yaml
          MODIFIER_CHANCE: 0.15
          TWIN_MECHANIC_CHANCE: 0.12
          WILDCARD_SLOT_CHANCE: 0.2
```

In `jest.setup-test-env.js`, `// Games` block:

```javascript
process.env.MODIFIER_CHANCE = '0.15'
process.env.TWIN_MECHANIC_CHANCE = '0.12'
process.env.WILDCARD_SLOT_CHANCE = '0.2'
```

- [ ] **Step 5: Implement `selectCategoryConstraints`**

Append to `src/utils/constraint-selection.ts`:

```typescript
import {
  categoryConstraintTiers,
  constraintModifiers,
  tier2CategoryConstraints,
  TierDefinition,
  twinSuffix,
  wildcardConstraint,
} from '../assets/constraints'
import { modifierChance, twinMechanicChance, wildcardSlotChance } from '../config'
```

(merge the asset imports with the existing import statement rather than duplicating it)

```typescript
// Every special roll is consumed unconditionally and before any slot draw, so the random
// sequence stays stable no matter which branch is taken. Tests depend on this.
export const selectCategoryConstraints = (count: number, random: () => number): string[] => {
  const wildcardRoll = random()
  const twinRoll = random()
  const modifierRoll = random()
  const modifierIndexRoll = random()
  const modifierChoiceRoll = random()

  const useWildcard = wildcardRoll < wildcardSlotChance
  // Mutually exclusive with the wildcard: at most one structural special per game bounds variance.
  const useTwin = !useWildcard && twinRoll < twinMechanicChance

  const selected: string[] = []
  if (useWildcard) {
    selected.push(wildcardConstraint)
  }
  if (useTwin) {
    // Twins are tier 2 only. A twin homophone or twin anagram pair would be exactly the
    // gimmicky output this work is trying to reduce.
    const twin = tier2CategoryConstraints[Math.floor(random() * tier2CategoryConstraints.length)] + twinSuffix
    selected.push(twin, twin)
  }
  selected.push(...drawConstraints(count - selected.length, random).map(({ constraint }) => constraint))

  if (modifierRoll >= modifierChance) {
    return selected
  }

  const firstModifiable = useWildcard ? 1 : 0
  const modifiableCount = count - firstModifiable
  const target = firstModifiable + Math.floor(modifierIndexRoll * modifiableCount)
  const modifier = constraintModifiers[Math.floor(modifierChoiceRoll * constraintModifiers.length)]
  return selected.map((constraint, index) => (index === target ? `${constraint} ${modifier}` : constraint))
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/unit/utils/constraint-selection.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/assets/constraints.ts src/utils/constraint-selection.ts src/config.ts template.yaml jest.setup-test-env.js __tests__/unit/utils/constraint-selection.test.ts
git commit -m "Add wildcard, twin-mechanic, and modifier constraint slots"
```

---

### Task 6: Wire selection into `getModelContext`

**Files:**
- Modify: `src/services/games.ts`, `src/assets/constraints.ts`
- Test: `__tests__/unit/services/games.test.ts`

**Interfaces:**
- Consumes: `selectCategoryConstraints` from Task 5.
- Produces: no new exports. `getModelContext` now emits `categoryConstraints` from the weighted draw.

- [ ] **Step 1: Write the failing test**

Replace the existing `'should create a game with normalConstraints (categoryConstraints)'` assertion on `categoryConstraints` (currently `__tests__/unit/services/games.test.ts:59`) with:

```typescript
          categoryConstraints: expect.arrayContaining([expect.any(String)]),
```

and append a new test inside `describe('createGame', ...)`:

```typescript
    it('should request exactly four category constraints', async () => {
      mockMathRandom.mockReturnValueOnce(1)

      await createGame('2025-01-01', mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.categoryConstraints).toHaveLength(4)
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/games.test.ts -t 'four category constraints'`
Expected: FAIL — the old `getRandomSample` path still runs and the assertion on the pinned tier-1 string no longer matches.

- [ ] **Step 3: Replace the draw in `getModelContext`**

In `src/services/games.ts`, remove `categoryConstraints as categoryConstraintChoices` from the `../assets/constraints` import and add:

```typescript
import { selectCategoryConstraints } from '../utils/constraint-selection'
```

Add near the top of the module:

```typescript
// Word constraints can request five categories, but that path bypasses category constraints
// entirely, so this is always four.
const CATEGORY_SLOT_COUNT = 4
```

Replace the `else` branch of `getModelContext` (currently `src/services/games.ts:106-118`):

```typescript
  } else {
    const categoryConstraints = selectCategoryConstraints(CATEGORY_SLOT_COUNT, random)
    return {
      categoryConstraints,
      disallowedCategories,
      inspirationAdjectives,
      inspirationNouns,
      inspirationVerbs,
    }
  }
```

- [ ] **Step 4: Remove the compatibility export**

Delete the temporary `categoryConstraints` export added in Task 4 Step 6 from `src/assets/constraints.ts`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. If `getRandomSample` is now unused for constraints but still used for inspiration words, leave it; if it has no remaining callers, delete it and its tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/services/games.ts src/assets/constraints.ts __tests__/unit/services/games.test.ts
git commit -m "Use the weighted constraint selection in getModelContext"
```

---

### Task 7: Generation prompt updates

**Files:**
- Modify: `prompts/create-connections-game.txt`

**Interfaces:**
- Consumes: the constraint text produced by Tasks 4-6.
- Produces: nothing consumed by later code tasks.

- [ ] **Step 1: Split the similarity rule**

Replace line 22 (`  - NEVER generate a category that is similar to disallowed categories, another category, or example categories ("weather" and "storms" are too similar)`) with:

```
  - NEVER generate two categories in the same SEMANTIC FIELD ("weather" and "storms" are too similar), and NEVER generate a category similar to a disallowed or example category
  - Two categories MAY share the same STRUCTURAL PATTERN as long as they use different instances of it (two "words that can follow ___" categories built on different words is good and creates useful ambiguity). This is required when a constraint is marked TWIN.
```

- [ ] **Step 2: Document the special slots**

Insert after the `categoryConstraints` bullet at line 15:

```
    - A constraint marked "TWIN" appears twice. Build two categories on that one pattern using different instances, and choose words that could plausibly belong to either.
    - A constraint that asks you to invent a pattern is a wildcard: create something genuinely absent from the other constraints, not a rewording of one.
    - A constraint ending in a sentence beginning "Additionally," carries an extra restriction that the category MUST also satisfy.
```

- [ ] **Step 3: Verify the file still parses as a prompt**

Run: `npx ts-node -e "const {readFileSync}=require('fs');const c=readFileSync('prompts/create-connections-game.txt','utf8');const m=/^[\s#]*(?<config>[^\n]+)\s*\n\s+(?<systemPrompt>.*?)\s+$/s.exec(c);JSON.parse(m.groups.config);console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add prompts/create-connections-game.txt
git commit -m "Teach the generation prompt about twin, wildcard, and modifier slots"
```

---

### Task 8: Decoys in the generation tool

**Files:**
- Modify: `src/types.ts`, `src/services/games.ts`
- Test: `__tests__/unit/services/games.test.ts`

**Interfaces:**
- Consumes: `validateGame` from Task 3.
- Produces: `Decoy` in `src/types.ts`; `validateDecoys(categories: CategoryObject, decoys: Decoy[]): void` from `src/services/games.ts`.

**Design note:** decoys are a generation-time forcing device, not game data. They are validated and then **dropped before verification and storage**, so the stored game shape and the public API response are unchanged. This also sidesteps decoys going stale when the verifier replaces a category.

- [ ] **Step 1: Write the failing test**

Append inside `describe('createGame', ...)`:

```typescript
    const decoyGame = {
      categories: {
        Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
        Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
        Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
        Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
      },
      wordList: [],
    }

    it('should accept a game with three well-spread decoys', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).resolves.toBeDefined()
    })

    it('should throw when there are too few decoys', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [{ looksLike: 'Cat2', word: 'WORD1' }],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Generated too few decoys')
    })

    it('should throw when decoys are concentrated in one pair of categories', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'WORD1' },
          { looksLike: 'Cat2', word: 'WORD2' },
          { looksLike: 'Cat1', word: 'WORD5' },
        ],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Decoys must span')
    })

    it('should throw when a decoy names a word that is not in the grid', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'NOTHERE' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Decoy references unknown word')
    })

    it('should throw when a decoy points at its own category', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat1', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await expect(createGame('2025-01-01', mockMathRandom)).rejects.toThrow('Decoy points at its own category')
    })

    it('should not persist decoys on the stored game', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await createGame('2025-01-01', mockMathRandom)

      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', expect.not.objectContaining({ decoys: expect.anything() }))
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/games.test.ts -t 'decoy'`
Expected: FAIL — no decoy validation exists, so the invalid cases resolve.

- [ ] **Step 3: Add the type**

In `src/types.ts`, next to `CategoryHistory`:

```typescript
export interface Decoy {
  looksLike: string
  word: string
}
```

- [ ] **Step 4: Extend the tool schema**

In `src/services/games.ts`, add to `gameTool.input_schema.properties` (alphabetical, before `categories`):

```typescript
      decoys: {
        items: {
          properties: {
            looksLike: { type: 'string' },
            word: { type: 'string' },
          },
          required: ['word', 'looksLike'],
          type: 'object',
        },
        maxItems: 5,
        minItems: 3,
        type: 'array',
      },
```

and add `'decoys'` to the schema's `required` array.

Update the tool description to explain the field:

```typescript
  description:
    'Submit the generated Connections game. `decoys` names words that plausibly belong to a different category in the same grid; supply 3 to 5, spanning at least 3 categories.',
```

- [ ] **Step 5: Implement validation**

Add to `src/services/games.ts` above `validateGame`:

```typescript
const MIN_DECOYS = 3
const MIN_DECOY_CATEGORY_SPAN = 3

export const validateDecoys = (categories: CategoryObject, decoys: Decoy[]): void => {
  if (decoys.length < MIN_DECOYS) {
    log('Generated too few decoys', { decoyCount: decoys.length })
    throw new Error(`Generated too few decoys: ${decoys.length}`)
  }

  const owningCategory = new Map<string, string>()
  Object.entries(categories).forEach(([name, category]) => {
    category.words.forEach((word) => owningCategory.set(word.toUpperCase(), name))
  })

  const touched = new Set<string>()
  decoys.forEach(({ looksLike, word }) => {
    const owner = owningCategory.get(word.toUpperCase())
    if (!owner) {
      log('Decoy references unknown word', { word })
      throw new Error(`Decoy references unknown word: ${word}`)
    }
    if (!(looksLike in categories)) {
      log('Decoy references unknown category', { looksLike })
      throw new Error(`Decoy references unknown category: ${looksLike}`)
    }
    if (looksLike === owner) {
      log('Decoy points at its own category', { looksLike, word })
      throw new Error(`Decoy points at its own category: ${word}`)
    }
    touched.add(owner)
    touched.add(looksLike)
  })

  // Without a spread requirement the model satisfies the count by loading all ambiguity into
  // one pair of categories and leaving the rest clean.
  if (touched.size < MIN_DECOY_CATEGORY_SPAN) {
    log('Decoys must span more categories', { touched: [...touched] })
    throw new Error(`Decoys must span at least ${MIN_DECOY_CATEGORY_SPAN} categories`)
  }
}
```

- [ ] **Step 6: Call it and strip the field**

In `createGame`, after `transformWordsToUpperCase` and the first `validateGame`:

```typescript
  const connectionsData = transformWordsToUpperCase(returnedData)
  validateGame(connectionsData.categories, categoryHistory)
  validateDecoys(connectionsData.categories, returnedData.decoys ?? [])

  // Decoys force the model to commit to cross-category misdirection at generation time.
  // They are not game data, so they never reach verification or storage.
  const { decoys: _decoys, ...gameWithoutDecoys } = connectionsData as ConnectionsData & { decoys?: Decoy[] }
  const verifiedGame = await verifyAndFixGame(gameWithoutDecoys, modelContext)
```

Add `Decoy` to the `../types` import list.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest __tests__/unit/services/games.test.ts`
Expected: PASS. The pre-existing tests whose mocked responses carry no `decoys` now hit `validateDecoys` with `[]` and would fail — update those mocks to include three valid decoys, or gate the call as shown so only responses that supply the field are checked. **Prefer updating the mocks**: the field is `required` in the schema, so a response without it is a real error.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/types.ts src/services/games.ts __tests__/unit/services/games.test.ts
git commit -m "Require and validate cross-category decoys at generation time"
```

---

### Task 9: Decoy audit in verification

**Files:**
- Modify: `src/services/verification.ts`, `src/services/games.ts`, `prompts/verify-connections-game.txt`
- Test: `__tests__/unit/services/verification.test.ts`

**Interfaces:**
- Consumes: `Decoy` from Task 8.
- Produces: `verifyAndFixGame(game, modelContext, decoys?)` gains a third parameter.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` in `__tests__/unit/services/verification.test.ts`:

```typescript
  it('should pass decoys to the verifier as context', async () => {
    const decoys = [{ looksLike: 'Cat2', word: 'WORD1' }]

    await verifyAndFixGame(game, {}, decoys)

    expect(bedrock.invokeModel).toHaveBeenCalledWith(
      prompt,
      verdictTool,
      expect.objectContaining({ decoys }),
    )
  })

  it('should omit decoys from context when none are supplied', async () => {
    await verifyAndFixGame(game, {})

    expect(bedrock.invokeModel).toHaveBeenCalledWith(
      prompt,
      verdictTool,
      expect.not.objectContaining({ decoys: expect.anything() }),
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/services/verification.test.ts -t 'decoy'`
Expected: FAIL — `verifyAndFixGame` takes two parameters and never emits `decoys`.

- [ ] **Step 3: Thread decoys into the verifier context**

In `src/services/verification.ts`, change `getVerifierContext` and `verifyAndFixGame`:

```typescript
const getVerifierContext = (
  game: ConnectionsGame,
  modelContext: Record<string, any>,
  decoys?: Decoy[],
): Record<string, any> => ({
  categoryConstraints: modelContext.categoryConstraints,
  game,
  wordConstraints: modelContext.wordConstraints,
  ...(decoys && decoys.length > 0 ? { decoys } : {}),
})

export const verifyAndFixGame = async (
  game: ConnectionsGame,
  modelContext: Record<string, any>,
  decoys?: Decoy[],
): Promise<ConnectionsGame> => {
  const verifierContext = getVerifierContext(game, modelContext, decoys)
```

Add `Decoy` to the `../types` import list.

In `src/services/games.ts`, pass them through:

```typescript
  const verifiedGame = await verifyAndFixGame(gameWithoutDecoys, modelContext, returnedData.decoys)
```

- [ ] **Step 4: Add the verifier check**

In `prompts/verify-connections-game.txt`, add a numbered check after check 6 (hint quality):

```
7. **Decoy claims** - When the input includes `decoys`, each entry claims that `word` plausibly belongs to the category named in `looksLike` as well as to its own category. Verify each claim: the word must genuinely be something a solver could place in that other category. Flag any decoy whose claim does not hold — the game asserted misdirection that is not actually there.
```

Update the `<context>` description near the top of the file to mention the field:

```
- "decoys": words the generator claims are plausible members of a second category, if any
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/unit/services/verification.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/services/verification.ts src/services/games.ts prompts/verify-connections-game.txt __tests__/unit/services/verification.test.ts
git commit -m "Have the verifier audit generated decoy claims"
```

---

## Post-implementation

- [ ] Run `npm test` and confirm coverage thresholds in `jest.config.ts` still pass.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] Deploy prompts with `npm run deploy-prompts` — prompt changes are served from DynamoDB and do not ship with a normal deploy.
- [ ] The three probabilities (`MODIFIER_CHANCE` 0.15, `TWIN_MECHANIC_CHANCE` 0.12, `WILDCARD_SLOT_CHANCE` 0.2) are opening guesses. Review generated output before treating them as settled.
