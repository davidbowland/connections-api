# Misdirection constraints and token headroom

Date: 2026-08-09

## Problem

Game generation began failing consistently after `WILDCARD_SLOT_CHANCE` was
raised to 1.2 (always on). A representative failure:

```
Model response missing tool_use block and text block {
  blockTypes: [ 'thinking' ],
  stopReason: 'max_tokens',
  toolName: 'submit_game'
}
```

The model spent 5.5 minutes and every available token on thinking, then died
before emitting a single output block.

### Root cause

`max_tokens` bounds thinking **and** output together. `prompts/create-connections-game.txt:1`
sets `maxTokens: 24000` with `thinkingEffort: "high"`, and `src/services/bedrock.ts`
sends `thinking: { type: 'adaptive' }`. A constraint set hard enough to push
adaptive thinking past 24,000 tokens leaves nothing for the `submit_game` call,
and `extractModelPayload` throws.

Two factors turned a marginal failure into a total one:

- **Retries re-roll constraints.** `src/handlers/create-game.ts:48` calls
  `createGame(gameId)` fresh on each attempt. At `WILDCARD_SLOT_CHANCE: 0.2`,
  the chance all three production attempts drew a wildcard was 0.008. At 1.2 it
  is every attempt, every time. The wildcard did not become broken — it stopped
  being diluted. (Test uses `maxGameGenerationAttempts: 1`, so a single bad roll
  is fatal there.)
- **No token-usage visibility.** `src/services/bedrock.ts` never reads `usage`
  from the model response, so there is no way to tell whether a healthy game
  finishes at 9k tokens or at 23k. The ceiling was invisible until it was hit.

A single log cannot isolate which constraint exhausted the budget: the failing
run drew both the wildcard and the `constraintModifiers[4]` modifier. Both are
addressed below on their own merits.

### Design defect, independent of the token budget

`src/assets/constraints.ts:95` reads:

> Additionally, combine this pattern with a second unrelated pattern so that
> each word satisfies both at once.

This is the only modifier that stacks a second **category pattern** onto a
category. Every other modifier stacks a **word property** — "also a common
verb", "also proper nouns in a different context", "share one unrelated surface
property".

That distinction decides whether a constraint produces misdirection:

- A **word property** gives each word a second reading, which is the pull that
  drags a solver toward the wrong group. That is misdirection.
- A **second category pattern** is invisible to the solver. Either the category
  name omits it (it did nothing) or the name includes it (it is now a
  convoluted hint, not a trap). It also shrinks the candidate pool for that
  category, leaving the constructor *fewer* words to choose from with good
  cross-category second readings — spending the misdirection budget to buy
  confusion.

It is also an expensive search: four words in the intersection of two sparse
sets, that avoid collision with three other categories, each seeded from a
different inspiration word.

`constraintModifiers[0]` and `[3]` are also "all words satisfy both", but both
stack word properties, so they stay unchanged.

## Changes

### 1. Wildcard constraint

`src/assets/constraints.ts:81-82`. Current text:

> Invent a category pattern that does not appear elsewhere in this list and is
> not a close variant of one. Describe the pattern plainly in the category name.

New text:

> Invent a category pattern of your own instead of reaching for a familiar one.
> It must not restate any of the other constraints in this list. Describe the
> pattern plainly in the category name, and choose words that could plausibly
> belong to another category in this game.

Three defects addressed:

- **Ambiguous referent.** "This list" plausibly reads as the 500-entry
  `disallowedCategories` array rather than the sibling constraints. The prompt
  already forbids reusing disallowed categories at
  `prompts/create-connections-game.txt:27`, so the wildcard should not
  re-litigate 500 entries. The replacement binds the check to "the other
  constraints in this list".
- **Unverifiable clause.** "Not a close variant of one" has no state in which
  the model can conclude it is satisfied. Removed.
- **No positive target.** Every tier constraint states what to do; this one
  stated only what not to do, against an unbounded space. The replacement adds
  the cross-category plausibility bar the rest of the system aims at.

The slot is kept rather than deleted because
`docs/superpowers/specs/2026-08-08-game-variety-and-misdirection-design.md:117`
makes logging invented patterns — so good ones can be promoted into the tier
lists by hand — the point of the wildcard.

### 2. Misdirection modifier

`src/assets/constraints.ts:95`, replaced in place at index 4. New text:

> Additionally, choose words for this category so that at least two of them
> would also look at home in one of the other categories in this game. The
> second reading must be real, not a stretch.

Three deliberate choices:

- **"Choose", not "prefer".** Hedged verbs are read as permission to
  under-deliver. This modifier fires on 15% of games; when it fires it should
  bite.
- **"At least two", not "each".** Requiring a genuine second reading from all
  four words, stacked on every other constraint, is the over-constraint that
  makes a firm verb dangerous. A concrete, achievable count removes the
  pressure to fabricate.
- **An honesty guard.** Mirrors the existing decoy rule at
  `prompts/create-connections-game.txt:46` ("A decoy must name a real,
  defensible second reading of that word — not a stretch invented to satisfy
  the count").

Replacing in place keeps `constraintModifiers.length` at 6, so the positional
assertions in `__tests__/unit/utils/constraint-selection.test.ts` (which index
`[0]` and `[length - 1]`) are unaffected.

### 3. Token headroom

`prompts/create-connections-game.txt:1`: `maxTokens` 24000 → 32000.

Not higher: `createGame` invokes the model twice (generation, then verification
at 8000 tokens), and 24k already consumed 5.5 minutes. The `CreateGameFunction`
Lambda `Timeout` is 900s (`template.yaml:268`, via the `createGameTimeout` map
key). 32k is margin for the tail without crowding that ceiling.

(The `GAME_GENERATION_TIMEOUT` env var reads the same map key but is a
generation-lock expiry in `src/services/dynamodb.ts:59`, not a request
timeout. The two happen to share a value; only the Lambda `Timeout` bounds
this call.)

`thinkingEffort` stays `high` for generation, and `medium` for verification
(already the value in `prompts/verify-connections-game.txt:1` — unchanged).

Lowering generation to `medium` is the better long-term cost lever, but it is
deliberately deferred: this change already alters three inputs to token usage
(both constraint rewrites and `maxTokens`). Changing effort simultaneously
destroys attribution in both directions — a quality regression could not be
traced to a knob, and a success would not reveal whether the effort drop was
load-bearing. `verifierChangedGame` (`src/services/games.ts:367`) is the
regression metric; it needs a baseline at `high` first.

### 4. Token usage logging

`src/services/bedrock.ts` currently logs `usage` nowhere. Add one log per
invocation carrying `inputTokens`, `outputTokens`, `stopReason`, `model`, and
`toolName`.

This must fire on **both** paths:

- Success — otherwise there is no baseline to compare a failure against, and no
  data for the effort sweep above.
- Failure — `extractModelPayload` already logs `stopReason` when no usable
  block is present, but not the token counts that show how close the run came
  to the ceiling.

Implemented by logging immediately after the response is decoded and before
payload extraction, so a throw inside `extractModelPayload` cannot skip it.

## Testing

Existing tests reference constraints by exported symbol
(`wildcardConstraint`, `constraintModifiers[n]`), never by literal text, so
both rewrites keep the suite green without edits.

`prompts/*.txt` config is not read by unit tests — `__tests__/unit/__mocks__.ts`
supplies its own `prompt` fixture — so the `maxTokens` change touches no test.

New coverage required for the logging change:

- Asserts `log` is called with the token counts and stop reason from the
  decoded response on a successful invocation.
- Asserts the same log fires when the response contains no `tool_use` or `text`
  block (the failure path), before the error propagates.

The mock at `__tests__/unit/__mocks__.ts:82-84` already carries
`stop_reason: 'tool_use'` and `usage: { input_tokens: 3_398, output_tokens: 99 }`,
so no fixture changes are needed.

Per `CLAUDE.md`: no `beforeEach`, no `if` statements in tests, mocks cleared
automatically. The change introduces no clock or randomness, so no injection is
required.

## Deployment

Follow the established convention from `0b7de1c` — prompts first, then code:

1. `npm run deploy-prompts <prompts-table>` to push `maxTokens: 32000` to the
   prompts table.
2. Deploy the code change (constraint text, usage logging).

**Unlike the decoys change set that motivated that convention, order is not
load-bearing here.** The two halves are independent, and each is on its own an
improvement over the current state:

- Prompts first → old (expensive) constraints under the new 32000 ceiling:
  more headroom than today.
- Code first → new (cheaper) constraints under the old 24000 ceiling: less
  thinking demanded than today.

Neither ordering produces a broken intermediate state, because nothing in this
change set couples the tool schema to the prompt text. Prompts-first is still
the right habit, but a partial deploy is not an outage.

## Out of scope

- Lowering generation `thinkingEffort` to `medium` — deferred pending baseline
  data, as above.
- `constraintModifiers[0]` and `[3]` — word-property modifiers, not affected by
  the defect described here.
- `WILDCARD_SLOT_CHANCE` itself. The value is an operational dial; this change
  makes the wildcard cheap enough that 1.2 is survivable, but choosing the
  production value is a separate tuning decision.
