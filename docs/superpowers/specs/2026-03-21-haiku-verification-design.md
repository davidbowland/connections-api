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
  ├─ [existing] invoke Sonnet → raw game
  ├─ [existing] mechanical validation (throws on failure)
  ├─ [NEW] verifyAndFixGame(connectionsData, modelContext) → ConnectionsData
  │     ├─ pass  → return game unchanged
  │     ├─ fix   → apply replacements → mechanical validation (once)
  │     │             ├─ passes → return fixed game
  │     │             └─ fails  → throw
  │     └─ fail  → throw
  └─ [existing] save to DynamoDB
```

All throws bubble to the `while(true)` loop in `create-game.ts` and trigger a fresh Sonnet generation. No special error types are needed.

## New File: `src/services/verification.ts`

Exports one function:

```ts
export const verifyAndFixGame = async (
  game: ConnectionsData,
  modelContext: Record<string, any>,
): Promise<ConnectionsData>
```

Steps:

1. Fetch Haiku prompt via `llmVerifyPromptId` (same DynamoDB pattern as `llmPromptId`)
2. Call `invokeModel(prompt, { game, modelContext })`
3. Parse `VerificationResult` from response
4. Handle verdict:
   - `pass` → return `game` unchanged
   - `fail` → throw
   - `fix` → validate fix bounds, apply fixes, run mechanical validation, return or throw

## New Type: `VerificationResult`

Added to `src/types.ts`:

```ts
export interface VerificationResult {
  verdict: 'pass' | 'fix' | 'fail'
  reason: string
  fixes?: {
    [categoryName: string]: {
      words?: string[] // full 4-word replacement list
      category?: {
        // full category replacement (name + content)
        name: string
        words: string[]
        hint: string
        embeddedSubstrings: string[]
      }
    }
  }
}
```

Haiku always returns the **full corrected list**, not a diff. The service diffs in code to enforce limits.

## Fix Limits (enforced in service, not prompt)

| Limit                               | Value | Behaviour if exceeded |
| ----------------------------------- | ----- | --------------------- |
| Word changes per category           | ≤ 2   | throw                 |
| Word changes total (all categories) | ≤ 4   | throw                 |
| Category replacements               | ≤ 1   | throw                 |
| Unrecognised verdict                | —     | throw                 |

After applying fixes, mechanical validation runs **once**. Failure → throw. No second Haiku call.

## Changes to `src/services/games.ts`

- `getModelContext()` currently returns `Record<string, any>` but the value is only used locally. It needs to return `modelContext` so `createGame()` can pass it to `verifyAndFixGame()`.
- `createGame()` calls `verifyAndFixGame(connectionsData, modelContext)` after existing mechanical validation and before `setGameById`.

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
| `fix` where mechanical re-validation fails            | throws                                   |
| `fail` verdict                                        | throws                                   |
| Malformed Haiku response                              | throws                                   |

Bedrock calls mocked the same way existing tests mock them.

## Files Changed

| File                                  | Change                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/services/verification.ts`        | **new** — verification service                                              |
| `src/services/games.ts`               | thread `modelContext` out of `getModelContext()`, call `verifyAndFixGame()` |
| `src/types.ts`                        | add `VerificationResult`                                                    |
| `src/config.ts`                       | add `llmVerifyPromptId`                                                     |
| `prompts/verify-connections-game.txt` | **new** — Haiku verification prompt                                         |
| `prompts/create-connections-game.txt` | update Sonnet model to `us.anthropic.claude-sonnet-4-6`                     |
| `src/services/verification.test.ts`   | **new** — unit tests                                                        |
