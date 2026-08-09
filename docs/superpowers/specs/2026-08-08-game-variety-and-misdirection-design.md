# Improving generated game quality: variety and misdirection

**Date:** 2026-08-08
**Status:** Approved design, not yet implemented

## Problem

Generated games are solid but two failure modes recur:

1. **Categories with obvious boundaries.** When a category is a small closed set
   (MATTHEW / MARK / LUKE / JOHN), identifying one word forces the other three.
   The puzzle collapses. Nothing in the pipeline tests for this: the verifier's
   only obviousness check is pairwise leakage between two words
   (`verify-connections-game.txt:19`), which a closed set passes trivially.

2. **Stale gimmick words.** "Backwards" categories are almost always STOP/POTS,
   and similar attractors dominate the other spelling mechanics. The model's
   prior over reversible English words is genuinely narrow, so this cannot be
   prompted away.

Underlying both: categories always feel like "a certain type." The taxonomy in
`src/assets/constraints.ts` is 35 patterns, and every game draws four of them,
so the space of possible games is small enough to develop a recognizable flavor.

### Measured causes

- **Tier 3 is not rare.** The constraint pool is built by array repetition:
  13 tier-1 entries × 4 + 9 tier-2 × 2 + 13 tier-3 × 1 = 83 entries. Tier 3 is
  15.7% of draws, so `P(at least one tier-3 in four draws) = 1 - (70/83)^4 ≈ 49%`.
  Discounting the word-constraint path (`WORD_CONSTRAINT_CHANCE: 0.12`) and
  holidays, roughly 40% of all games carry a tier-3 category. "Words spelled
  backwards" alone lands in ~4.5% of games — about 16 a year, against maybe
  eight good reversible words.

- **Misdirection is unenforced.** `create-connections-game.txt:84` ("ALWAYS
  ensure words could plausibly fit in multiple categories") is the most
  important line in the prompt. It is a soft instruction, absent from the tool
  schema and unchecked by the verifier.

- **Accidental duplicates are the wrong duplicates.** `games.ts:107` samples
  four constraints `withDuplicates: true`, so ~20% of games already draw the
  same constraint twice. Because tier-1 carries 4× weight, those collisions are
  almost always tier-1 — and two "Things sharing a property" categories produce
  no word overlap. Meanwhile `create-connections-game.txt:22` tells the model to
  avoid similar categories, which suppresses the construction rather than using
  it.

- **`disallowedCategories` grows without bound.** `GamesTable` has no
  `TimeToLiveSpecification` (`template.yaml:390`) and the only delete path is
  reroll (`reroll-game.ts:57`), so every category from every game accumulates
  into the prompt.

## Non-goals

- Word-level novelty memory. Recently-used words already age out of the game
  history in practice, and banning tokens outright is over-correction: STOP in
  "backwards animals" and STOP in "road sign words" are different puzzles.
- A third model call to measure difficulty empirically. LLM solvers are
  miscalibrated against human solvers in exactly the areas this game exercises.
- Raising baseline difficulty. Harder mechanics should appear *sometimes*, not
  more often overall.

---

## Phase 1 — Constraint selection

All of this lives in `src/assets/constraints.ts` and the `getModelContext` path
in `src/services/games.ts`. It is the highest-leverage phase and is independent
of Phase 2.

### 1.1 Explicit weighted draw

Replace array repetition with a weighted selection over the three tiers. The
weights become legible values rather than a count of spread operators, and they
can be asserted in tests.

Retune so tier 3 appears in roughly 20% of games rather than 40%. That needs
tier 3 at about 6% of draws (`1 - (1 - 0.06)^4 ≈ 0.21`), versus 15.7% today.

`getRandomSample` keeps its injected `random` parameter so selection stays
deterministic under test.

### 1.2 Cap tier-3 patterns at one per game

A game may use at most one tier-3 *pattern*. The cap counts patterns, not
categories, so a tier-3 pattern used twice by the twin slot (§1.3) would still
be one — though twins are restricted to tier 2, so that case cannot arise.

On its own this cap only affects the ~12% of games that currently draw two or
more tier-3 constraints; the reweight in §1.1 does the real work. Both are
needed.

### 1.3 Twin-mechanic slot

With probability `TWIN_MECHANIC_CHANCE`, draw one **tier-2** mechanic and assign
it to two of the four slots. The prompt instructs the model to pick two
different instances of that pattern and to choose words that plausibly satisfy
either instance.

This is the classic hard-puzzle construction — two "words that can follow ___"
groups where a word could follow either — and it creates forced ambiguity
without inventing a new mechanic.

Restricted to tier 2 deliberately. Tier-2 patterns (words after X, words before
X, compound components, nouns that are also verbs) are accessible and produce
genuine overlap. A twin tier-3 pattern (two homophone groups, two anagram
groups) would be brutal and gimmicky.

### 1.4 Wildcard slot

With probability `WILDCARD_SLOT_CHANCE`, replace one drawn constraint with an
instruction to invent a category pattern not present in the list.

Exactly one slot. Leaving all four unconstrained regresses to the model's stock
priors, which is where the boring categories come from in the first place.

Log every invented pattern so good ones can be promoted into the tier lists by
hand. That feedback loop is the point.

### 1.5 Modifier layer

With probability `MODIFIER_CHANCE`, apply a twist to one drawn constraint —
invert it, add a cross-cutting restriction, or combine it with a second pattern.

This is the direct answer to "categories are always of a certain type": a
second orthogonal axis turns 35 patterns into hundreds. It is also the change
most likely to produce incoherent output, so it fires at a low rate and its
results are subject to the Phase 2 verifier checks.

### 1.6 Composition rules

Slots are filled in this order:

1. Roll wildcard and twin. **They are mutually exclusive** — at most one
   structural special per game, to bound variance.
2. Reserve slots for whichever special fired.
3. Fill remaining slots by weighted draw, respecting the tier-3 cap.
4. Roll modifier; if it fires, apply the twist to one non-wildcard slot.

Modifier may stack with either special. Holiday and word constraints continue to
bypass this path entirely, unchanged.

### 1.7 New configuration

Three probabilities, as environment variables in `template.yaml` alongside
`WORD_CONSTRAINT_CHANCE`, read through `src/config.ts`:

| Variable | Starting value |
|---|---|
| `TWIN_MECHANIC_CHANCE` | 0.12 |
| `WILDCARD_SLOT_CHANCE` | 0.20 |
| `MODIFIER_CHANCE` | 0.15 |

These are opening guesses meant to be tuned after observing output.

### 1.8 Prompt changes

`create-connections-game.txt:22` currently forbids categories similar to one
another. Split the rule:

- **Same pattern, different instance** — permitted, and required when the twin
  slot fires.
- **Same semantic field** — still forbidden ("weather" and "storms").

---

## Phase 2 — Grid quality enforcement

### 2.1 Trap matrix

Add a `decoys` field to the `submit_game` tool schema (`src/services/games.ts`).
For a chosen word, it names the *other* category in the same grid that the word
plausibly belongs to.

Requirements, enforced in `validateGame`:

- 3 to 4 decoys per grid, hard cap 5.
- Decoys must touch at least 3 of the 4 categories. Without this the model
  satisfies the count by loading all ambiguity into one pair and leaving the
  other categories clean — the exact failure being fixed.
- No per-category minimum. Some categories are legitimately clean.

The schema forces the model to commit to the reasoning step before submitting,
which is the reliable way to make a soft instruction stick.

**Known limitation:** structured output forces commitment, not truth. The model
can write plausible decoys that do not hold up. The verifier check below is not
optional — without it the field is decoration.

### 2.2 Verifier audits decoys

Add a check to `verify-connections-game.txt`: for each claimed decoy, confirm
the word actually could belong to the named category. A grid whose decoy claims
do not survive audit is a `fix`.

### 2.3 Charged-word blocklist

A hard-coded list of slurs and charged terms, enforced in `validateGame`
(`src/services/games.ts:143`), rejecting the generation so
`maxGameGenerationAttempts` retries.

Deliberately **not** fed to the model. `create-connections-game.txt:9` already
asks for this softly; putting an explicit list of slurs in the prompt primes
toward the semantic neighborhood being avoided. Enforce at the boundary, per the
project's security guidance, and leave the prompt instruction soft.

### 2.4 Bound `disallowedCategories`

The ban list is doing two jobs, and only one of them needs the model. Split it.

**One window, shared by both mechanisms: the 500 most recent categories.** Games are keyed by date,
so sort by `GameId` descending and accumulate categories until the limit is
reached in `createGame` (`src/services/games.ts:171`). This exists to prevent
*semantic* restatement ("Ways to say yes" vs "Synonyms for affirmative"), which
only a model can catch and where recency matters most. Roughly 4,300 input
tokens per generation.

`alwaysDisallowedCategories` is unaffected and always included.

**Everything older is covered by neither**, deliberately. See §2.5.

### 2.5 Code-side repeat rejection

Reject exact and near-exact repeats in `validateGame` against **the same window
the model is shown** — not the entire archive. Two deterministic layers, no
similarity thresholds.

**Why the windows must match.** An earlier draft checked the full archive while
showing the model only the recent 500. That makes every older name a trap: the
model cannot avoid what it was not told about, so the generation dies after the
fact with no way for it to have done better. The owner rejected exactly this
shape of post-generation failure once before (2026-07-18) in favour of
prompt-level steering. Sharing one window keeps the code layer honest — a
rejection only ever fires for a name the model was handed and explicitly told
not to paraphrase, making it a backstop for slips rather than a minefield. The
cost is that a category may recur after roughly 125 games.

**Layer 1 — normalized exact.** Lowercase, collapse whitespace, strip
punctuation and leading articles, normalize blank runs (`____`, `–––`) to a
single `___` sentinel. Catches casing and spacing drift.

**Layer 2 — stemmed token set.** Drop stopwords, apply a light stemmer
(trailing `s`/`es`), compare as a set. `"Homophones of body parts"` and
`"Body part homophones"` both reduce to `{homophone, body, part}`. This is the
paraphrase class that actually recurs: reordering, pluralization, "X of Y" ↔
"Y X".

Two constraints that are easy to get wrong:

- **Blanks are positional and token sets destroy that.** `"___ BALL"` and
  `"BALL ___"` both reduce to `{ball}` but are unrelated categories. Any name
  containing a blank marker skips Layer 2 and uses Layer 1 only, with the
  blank's position preserved in the key.
- **The stopword list must not eat the mechanic.** `after`, `before`, `first`,
  `last`, `second`, `ending`, `starting`, `containing`, `plus`, `minus` are
  content words here. Strip them and `"Words after SWEET"` matches
  `"Words before SWEET"`.

**Rejected approach: character-level similarity** (Levenshtein, trigram Dice,
Jaccard on n-grams). `"Types of tomatoes"` and `"Types of potatoes"` are edit
distance 2 and score high on trigram overlap while being entirely unrelated.
Short names drawn from a shared domain make character similarity actively
hostile. Embeddings would handle it but add a service dependency and a tuned
threshold to solve what §2.4 already covers.

**Zero false positives is the requirement.** A false match silently discards a
good category and burns a generation attempt with no visible cause. Both layers
are exact comparisons on derived keys for that reason; everything genuinely
fuzzy stays with the model, where a mistake is recoverable.

Shape:

```ts
const canonicalize = (name: string): string    // Layer 1
const tokenKey = (name: string): string | null // Layer 2; null when name has a blank
```

Both are pure string functions with no clock and no randomness. Two `Set`s are
built once per `createGame` from full history; a generated category is a repeat
if either key hits. On a hit `validateGame` throws and
`maxGameGenerationAttempts` retries, matching the existing validators.

Expected coverage: Layer 1 catches most literal repeats, Layer 2 most of the
remaining paraphrases. True semantic restatement survives both by design — that
is §2.4's job.

---

## Testing

Per `CLAUDE.md`, everything must be deterministic.

- `getModelContext` already accepts an injected `random`; the new probability
  rolls and the weighted draw thread through the same parameter. No live
  `Math.random()` in tests, no `beforeEach`, no `if` statements in test bodies.
- Weighted-draw tests assert tier distribution by feeding a fixed sequence of
  `random` values, not by sampling and checking a frequency.
- Composition rules get direct tests: wildcard and twin never co-occur; the
  tier-3 cap holds; modifier never lands on the wildcard slot.
- `validateGame` gets cases for decoy count, decoy category spread, and
  blocklist rejection.
- The `disallowedCategories` cap is tested against a fixture exceeding 500
  categories, asserting both the count and that the retained ones are the
  newest.
- `canonicalize` and `tokenKey` are pure functions and get direct table-driven
  tests, including the cases that must **not** match: `"___ BALL"` vs
  `"BALL ___"`, `"Words after SWEET"` vs `"Words before SWEET"`, and
  `"Types of tomatoes"` vs `"Types of potatoes"`.
- Repeat rejection is tested against history older than the 500-category
  model-visible window, confirming the code layer covers what the prompt no
  longer sees.

## Deployment

Prompts live in DynamoDB, not the repo. Prompt changes require
`npm run deploy-prompts`; they do not ship with a normal deploy.

## Sequencing

Group by coupling rather than by phase number.

**Ship together:** Phase 1 (§1.1–1.8), the charged-word blocklist (§2.3), and
the repeat-detection split (§2.4–2.5). The two Phase 2 items here are
independent of constraint selection — they touch `validateGame` and the history
plumbing, need no tuning, and carry no interaction risk.

**Hold:** the trap matrix (§2.1–2.2), until the above has produced observable
output. Two reasons. Phase 1 changes which categories are *requested* while the
trap matrix changes what must be *produced per category*; landing both at once
makes any regression unattributable. And the decoy requirement interacts with
the new slots in ways worth measuring first — a twin-mechanic game satisfies
3–4 decoys trivially, a wildcard game may not — so the count and the
≥3-category spread should be set against real output rather than guessed.

The three probabilities in §1.7 are tuned during the hold period.

## Already landed

- `af00b88` — generation moved to Claude Opus 5.
- `d3d315e` — verification moved to Claude Opus 5; removed the "triple-check"
  instruction, which produces over-verification on a model that self-verifies.
