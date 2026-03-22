# Haiku Verification Step for Game Generation

**Date:** 2026-03-21
**Status:** Approved

## Overview

Add a Claude Haiku verification step inside `createGame()` that semantically validates a Sonnet-generated connections game. Haiku returns a `pass`, `fix`, or `fail` verdict in a single call. Fixes are applied and mechanically re-validated once; any failure throws and triggers a fresh Sonnet retry via the existing infinite loop in `create-game.ts`.

## Motivation

The existing post-generation checks are purely mechanical (word count, uniqueness, embedded substring presence). They do not catch:

- Pattern categories (e.g. `[profession] + letter`) where all words use the same letter (e.g. all plurals ending in S)
- Embedded substring categories (e.g. "contains MITT") where `embeddedSubstrings` is empty but the category name implies a pattern
- Words that are too obvious — where two words together immediately betray the category
- Two categories that are semantically too similar

## Architecture

```
createGame()
  ├─ [existing] invoke Sonnet → connectionsData
  ├─ [existing] build wordList
  ├─ [REFACTORED] validateGame(connectionsData.categories, wordList) — throws on failure
  ├─ [NEW] const verifiedGame = await verifyAndFixGame(connectionsData, modelContext)
  │     ├─ pass  → return game unchanged
  │     ├─ fix   → validate fix bounds, apply replacements, return fixed game
  │     └─ fail  → throw
  ├─ [NEW] build finalWordList from verifiedGame.categories
  ├─ [NEW] validateGame(verifiedGame.categories, finalWordList) — throws on failure
  └─ [existing] setGameById({ ...verifiedGame, wordList: finalWordList })
```

All throws bubble to the `while(true)` loop in `create-game.ts` and trigger a fresh Sonnet generation. No special error types are needed.

## New File: `src/services/verification.ts`

Exports one function:

```ts
export const verifyAndFixGame = async (
  game: ConnectionsGame,
  modelContext: Record<string, any>,
): Promise<ConnectionsGame>
```

`ConnectionsGame` (not `ConnectionsData`) is used because at runtime `connectionsData` never contains a `wordList` field — the LLM only returns `{ categories }`, and the existing type annotation `ConnectionsData` on the return value is a pre-existing inaccuracy in `games.ts`. Using `ConnectionsGame` accurately reflects the runtime structure.

TypeScript accepts `connectionsData` (typed `ConnectionsData`) as input since `ConnectionsData` is structurally assignable to `ConnectionsGame` (it has all required properties plus more). However, the return value `ConnectionsGame` is **not** assignable back to `connectionsData: ConnectionsData` (missing `wordList`). Therefore `createGame()` must store the result in a separate `const verifiedGame: ConnectionsGame` variable and use it in subsequent steps rather than reassigning `connectionsData`.

`verifyAndFixGame` does **not** run mechanical validation internally. It applies fixes and returns the modified game. All validation runs in `createGame()` (see Changes to `src/services/games.ts`).

Steps:

1. Fetch Haiku prompt via `llmVerifyPromptId` (same DynamoDB pattern as `llmPromptId`)
2. Call `invokeModel(prompt, { game, modelContext })` — both are serialised as a single JSON blob under the `${context}` substitution; the prompt receives `{ "game": {...}, "modelContext": {...} }` as one object
3. Parse `VerificationResult` from response
4. Handle verdict:
   - `pass` → return `game` unchanged
   - `fail` → throw
   - `fix` → validate fix bounds, apply fixes, return fixed game

## New Type: `VerificationResult`

Added to `src/types.ts`:

```ts
export interface VerificationResult {
  verdict: 'pass' | 'fix' | 'fail'
  reason: string
  fixes?: {
    [categoryName: string]: {
      words?: string[] // full 4-word replacement list (word-only fix)
      category?: {
        // full category replacement (concept-level fix)
        name: string // new category name (may differ from outer key)
        words: string[]
        hint: string
        embeddedSubstrings?: string[]
      }
    }
  }
}
```

The outer key in `fixes` is the **old** category name (used to identify which entry to replace in the `CategoryObject`). When `category.name` differs from the outer key, the implementation removes the old key and inserts the new one. The service enforces that at most one such rename occurs.

Haiku always returns the **full corrected list**, not a diff. The service diffs in code to enforce limits.

## Fix Limits (enforced in service, not prompt)

| Limit                               | Value | Behaviour if exceeded |
| ----------------------------------- | ----- | --------------------- |
| Word changes per category           | ≤ 2   | throw                 |
| Word changes total (all categories) | ≤ 4   | throw                 |
| Category replacements               | ≤ 1   | throw                 |
| Unrecognised verdict string         | —     | throw                 |

Mechanical validation after fixes runs once in `createGame()`. Failure → throw. No second Haiku call. `verifyAndFixGame` itself does not run validation — it returns the modified game and lets `createGame()` validate.

## Changes to `src/services/games.ts`

- No changes to `getModelContext()`. Its return value is already assigned to `const modelContext` in `createGame()` and is available to pass to `verifyAndFixGame()`.
- Extract `isEmbeddedSubstringsValid` and the inline mechanical validation block into an exported `validateGame(categories: CategoryObject, wordList: string[]): void` helper. It includes all existing checks: word uniqueness, category count (`[4, 5]`), words-per-category count, and embedded substrings. `verification.ts` does not need to import it.
- Updated `createGame()` flow:
  1. Invoke Sonnet → `connectionsData`
  2. Build `const wordList` from `connectionsData` (existing)
  3. `validateGame(connectionsData.categories, wordList)` — throws on structural failure
  4. `const verifiedGame = await verifyAndFixGame(connectionsData, modelContext)`
  5. Build `const finalWordList` from `verifiedGame.categories`
  6. `validateGame(verifiedGame.categories, finalWordList)` — re-run once; throws on failure
  7. `const dataWithWordList = { ...verifiedGame, wordList: finalWordList }`
  8. `await setGameById(...)` — existing line

## New Prompt: `prompts/verify-connections-game.txt`

Config line (auto-deployed to DynamoDB on change):

```
# {"anthropicVersion":"bedrock-2023-05-31","maxTokens":4000,"model":"us.anthropic.claude-haiku-4-5-20251001-v1:0","temperature":0.2,"topK":50}
```

Low temperature (0.2) and tight topK — this is analytical/judicial work, not creative generation.

The prompt receives `game` and `modelContext` as `${context}` and instructs Haiku to check:

1. **Embedded substring categories** — every word must contain every string in `embeddedSubstrings`. Also catches cases where the category name implies a pattern but `embeddedSubstrings` is empty.
2. **Pattern categories** (`[X] + letter`, `[X] minus a letter`, etc.) — the letter must genuinely vary across words; flag if all words use the same letter (e.g. all profession plurals ending in S).
3. **Obviousness** — flag if 2+ words together would immediately betray the category to a casual solver.
4. **Category uniqueness** — flag if two categories are semantically too similar.

Verdict rules baked into the prompt:

- `pass` — no issues found
- `fix` — issues exist but fixable by replacing ≤ 2 words per category and/or ≤ 1 full category; return full corrected word lists / category objects
- `fail` — concept is fundamentally broken or would require more changes than the fix limits allow

## Config Change: `src/config.ts`

One new export:

```ts
export const llmVerifyPromptId = process.env.LLM_VERIFY_PROMPT_ID as string
```

`LLM_VERIFY_PROMPT_ID` must be added to the Lambda environment (infrastructure change, out of scope for this spec).

## Testing: `src/services/verification.test.ts`

| Case                                                  | Expected                                 |
| ----------------------------------------------------- | ---------------------------------------- |
| `pass` verdict                                        | returns game unchanged                   |
| `fix` with valid word replacements                    | applies replacements, returns fixed game |
| `fix` exceeding per-category limit (> 2 word changes) | throws                                   |
| `fix` exceeding total limit (> 4 word changes)        | throws                                   |
| `fix` with > 1 category replaced                      | throws                                   |
| `fail` verdict                                        | throws                                   |
| Unrecognised verdict string (e.g. `"retry"`)          | throws                                   |
| Malformed Haiku response (JSON parse failure)         | throws                                   |

Bedrock calls mocked the same way existing tests mock them.

Post-fix mechanical re-validation is tested in `src/services/games.test.ts` (not here), since it runs in `createGame()` not `verifyAndFixGame()`.

## Files Changed

| File                                  | Change                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `src/services/verification.ts`        | **new** — verification service                                          |
| `src/services/games.ts`               | extract `validateGame()`, call `verifyAndFixGame()`, rebuild `wordList` |
| `src/types.ts`                        | add `VerificationResult`                                                |
| `src/config.ts`                       | add `llmVerifyPromptId`                                                 |
| `prompts/verify-connections-game.txt` | **new** — Haiku verification prompt                                     |
| `src/services/verification.test.ts`   | **new** — unit tests for `verifyAndFixGame`                             |
| `src/services/games.test.ts`          | add test: post-fix `validateGame` failure triggers retry                |
