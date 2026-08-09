# Misdirection Constraints and Token Headroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generation failing on `max_tokens` by making two constraints cheaper and better-targeted, raising the token ceiling, and logging per-invocation token usage.

**Architecture:** Three independent changes. Two are single-string edits to exported constants in `src/assets/constraints.ts` (tests reference these by symbol, never by literal, so they stay green). One is a config edit to the prompt file that ships to DynamoDB separately from the Lambda. One adds a log call to `src/services/bedrock.ts`, placed before payload extraction so a throw cannot skip it.

**Tech Stack:** TypeScript, Jest (`clearMocks: true`), AWS SDK v3 Bedrock Runtime, AWS SAM.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-misdirection-constraints-and-token-headroom-design.md`
- Jest clears all mocks automatically — never manually clear mocks.
- Never use `beforeEach`. Shared defaults go in `beforeAll`; per-test overrides use `mockResolvedValueOnce`.
- No `if` statements in tests. No live `Date.now()` / `Math.random()` in test bodies.
- `constraintModifiers` must stay length 6, with the replacement at index 4 — `__tests__/unit/utils/constraint-selection.test.ts` indexes `[0]` and `[length - 1]`.
- `docs/` is in `.gitignore` (`.gitignore:62`) but spec/plan files there are tracked. Use `git add -f` for files under `docs/`.
- `lint-staged` runs on commit and cannot re-stage ignored paths; commit `docs/` files separately from source files.

---

### Task 1: Rewrite the wildcard and misdirection constraints

**Files:**
- Modify: `src/assets/constraints.ts:81-82` (`wildcardConstraint`)
- Modify: `src/assets/constraints.ts:95` (`constraintModifiers[4]`)
- Test: `__tests__/unit/utils/constraint-selection.test.ts` (existing, no edits expected)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `wildcardConstraint: string` and `constraintModifiers: string[]` (length 6) keep their existing names, types, and array positions. `src/utils/constraint-selection.ts` and `src/services/games.ts:368` import `wildcardConstraint` and compare it by identity — the text changes but the export does not.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npm test -- constraint-selection`
Expected: PASS. This is the baseline that proves the later run means something.

- [ ] **Step 2: Replace the wildcard constraint text**

In `src/assets/constraints.ts`, replace the `wildcardConstraint` value. Keep the leading comment.

```typescript
// Occupies a single slot and asks the model to invent a pattern the tier lists do not cover.
// Scoped to "the other constraints in this list" rather than an open-ended novelty check: the model
// also receives 500+ disallowedCategories, and an unbounded "is this a close variant of anything?"
// check is a search with no terminating state -- which is how this slot exhausted its token budget.
// The disallowed list is already enforced by the prompt itself, so it is not re-litigated here.
export const wildcardConstraint =
  'Invent a category pattern of your own instead of reaching for a familiar one. It must not restate any of the other constraints in this list. Describe the pattern plainly in the category name, and choose words that could plausibly belong to another category in this game.'
```

- [ ] **Step 3: Replace the misdirection modifier at index 4**

In `src/assets/constraints.ts`, replace only the fifth entry of `constraintModifiers` (currently `'Additionally, combine this pattern with a second unrelated pattern so that each word satisfies both at once.'`). Leave the other five entries and the array order untouched.

```typescript
  'Additionally, choose words for this category so that at least two of them would also look at home in one of the other categories in this game. The second reading must be real, not a stretch.',
```

Add this note above the `constraintModifiers` declaration, below the existing comment:

```typescript
// Every modifier here stacks a WORD PROPERTY (also a verb, also a proper noun, shares a surface
// trait). None stacks a second CATEGORY PATTERN. That distinction is deliberate: a word property
// gives each word a second reading, which is the pull that drags a solver toward the wrong group.
// A second category pattern is invisible to the solver -- the category name either omits it (it did
// nothing) or states it (a convoluted hint, not a trap) -- and it shrinks the candidate pool the
// constructor needs to find words with real cross-category readings. That is confusion, not
// misdirection, and the intersection search it demands is expensive.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, unchanged from Step 1. Tests import these constants by symbol, so no assertion contains the old literal text. If anything fails on a string comparison, that test was a change-detector and the failure is the signal to fix the test, not the constraint.

- [ ] **Step 5: Commit**

```bash
git add src/assets/constraints.ts
git commit
```

Message body: explain that the wildcard's novelty check was unbounded and its referent ambiguous, and that the replaced modifier stacked a category pattern rather than a word property.

---

### Task 2: Raise the generation token ceiling

**Files:**
- Modify: `prompts/create-connections-game.txt:1`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks. `Prompt['config']['maxTokens']` (`src/types.ts:69`) is unchanged as a type.

- [ ] **Step 1: Edit the prompt config header**

Line 1 of `prompts/create-connections-game.txt` is a JSON config comment. Change `maxTokens` from `24000` to `32000`. Change nothing else — `thinkingEffort` stays `"high"`, the model ID stays `us.anthropic.claude-opus-5`.

```
# {"anthropicVersion":"bedrock-2023-05-31","maxTokens":32000,"model":"us.anthropic.claude-opus-5","thinkingEffort":"high"}
```

Do **not** touch `prompts/verify-connections-game.txt` — it is already `"maxTokens":8000,"thinkingEffort":"medium"`, which the spec keeps.

- [ ] **Step 2: Verify the header still parses**

Run: `npx ts-node -e "const {readFileSync}=require('fs');const c=readFileSync('prompts/create-connections-game.txt','utf-8');const m=/^[\s#]*(?<config>[^\n]+)\s*\n\s+(?<systemPrompt>.*?)\s+$/s.exec(c);console.log(JSON.parse(m.groups.config))"`

Expected: prints the config object with `maxTokens: 32000`. This runs the exact regex from `scripts/deploy-prompts.ts:23`, so a malformed header fails here rather than at deploy time.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS. Unit tests supply their own prompt fixture (`__tests__/unit/__mocks__.ts`) and never read `prompts/*.txt`, so this should be a no-op for tests.

- [ ] **Step 4: Commit**

```bash
git add prompts/create-connections-game.txt
git commit
```

Message body: `max_tokens` bounds thinking and output together, so the old ceiling left nothing for the tool call when thinking ran long.

---

### Task 3: Log token usage on every model invocation

**Files:**
- Modify: `src/services/bedrock.ts`
- Test: `__tests__/unit/services/bedrock.test.ts`

**Interfaces:**
- Consumes: `wildcardConstraint` / `constraintModifiers` are unrelated; this task is independent of Tasks 1 and 2.
- Produces: a new module-private `logModelUsage(modelResponse, tool, model): void`. Not exported — `invokeModel`'s signature is unchanged.

Fixture facts needed for the tests (already present, no edits): `__tests__/unit/__mocks__.ts:82` has `stop_reason: 'tool_use'`, `:84` has `usage: { input_tokens: 3_398, output_tokens: 99 }`. `toolSchema.name` is `'submit_data'`. `prompt.config.model` is `'the-thinking-ai:1.0'`.

- [ ] **Step 1: Write the failing tests**

Add both tests inside the existing `describe('invokeModel', ...)` block in `__tests__/unit/services/bedrock.test.ts`. The file already has `jest.mock('@utils/logging')` and imports `log`.

```typescript
    it('should log token usage and stop reason on a successful invocation', async () => {
      await invokeModel(prompt, toolSchema)

      expect(log).toHaveBeenCalledWith('Model invocation complete', {
        inputTokens: 3_398,
        model: 'the-thinking-ai:1.0',
        outputTokens: 99,
        stopReason: 'tool_use',
        toolName: 'submit_data',
      })
    })

    it('should log token usage when the response carries no usable block', async () => {
      mockSend.mockResolvedValueOnce({
        ...invokeModelResponse,
        body: new TextEncoder().encode(
          JSON.stringify({
            ...invokeModelResponseData,
            content: [{ thinking: 'Ran out of room before answering', type: 'thinking' }],
            stop_reason: 'max_tokens',
          }),
        ),
      })

      await expect(invokeModel(prompt, toolSchema)).rejects.toThrow(
        'Model response contained no submit_data tool call',
      )

      expect(log).toHaveBeenCalledWith('Model invocation complete', {
        inputTokens: 3_398,
        model: 'the-thinking-ai:1.0',
        outputTokens: 99,
        stopReason: 'max_tokens',
        toolName: 'submit_data',
      })
    })
```

The second test is the one that matters: it reproduces the production failure (thinking-only content, `stop_reason: 'max_tokens'`) and pins that usage is logged *before* the throw. Without that ordering the failure path stays as blind as it was.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- bedrock`
Expected: FAIL — both new tests report that `log` was never called with `'Model invocation complete'`.

- [ ] **Step 3: Add the logging helper**

In `src/services/bedrock.ts`, add this above `extractModelPayload`:

```typescript
// Thinking and the tool call share one max_tokens budget, so a run that spends the whole budget
// thinking returns no tool_use block at all. Logged on every invocation rather than only on failure:
// a failure count says nothing without knowing how much headroom a healthy game leaves, and that
// headroom is what tells us whether the effort level can come down.
const logModelUsage = (
  modelResponse: { stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } },
  tool: ToolSchema,
  model: string,
): void => {
  log('Model invocation complete', {
    inputTokens: modelResponse.usage?.input_tokens,
    model,
    outputTokens: modelResponse.usage?.output_tokens,
    stopReason: modelResponse.stop_reason,
    toolName: tool.name,
  })
}
```

- [ ] **Step 4: Call it before payload extraction**

In `invokeModel`, insert the call between decoding and extraction. Extraction throws on the failure path, so logging must precede it.

```typescript
  const response = await sendToBedrock(command, prompt.config.model)
  const modelResponse = decodeResponseBody(response.body, prompt.config.model)
  logModelUsage(modelResponse, tool, prompt.config.model)
  const payload = extractModelPayload(modelResponse, tool, prompt.config.model)
  return validateResponse(tool, payload)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- bedrock`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: PASS. `src/services/games.ts` calls `invokeModel` twice per game, so its tests will now see an extra `log` call — if any of them assert an exact call count on `log`, relax that assertion to `toHaveBeenCalledWith`.

- [ ] **Step 7: Commit**

```bash
git add src/services/bedrock.ts __tests__/unit/services/bedrock.test.ts
git commit
```

---

### Task 4: Commit the plan

**Files:**
- Create: `docs/superpowers/plans/2026-08-09-misdirection-constraints-and-token-headroom.md` (this file)

The deployment note below is already written; this task only commits it.

## Deployment order

Prompts ship to DynamoDB via `npm run deploy-prompts <prompts-table>`, separately from the Lambda.
Convention from `0b7de1c` is prompts first, then code.

**Order is not load-bearing for this change set.** Nothing here couples the tool schema to the
prompt text, and each half independently reduces failure risk:

- Prompts first → old constraints under the new 32000 ceiling: more headroom than today.
- Code first → new, cheaper constraints under the old 24000 ceiling: less thinking demanded
  than today.

A partial deploy is therefore degraded-but-working, not an outage.

**After deploying, watch two log lines before tuning anything else:**

- `Model invocation complete` — the new one. `outputTokens` against the 32000 ceiling is the
  headroom measurement that decides whether `thinkingEffort` can drop to `medium`.
- `Generated game` (`src/services/games.ts:361`) — `verifierChangedGame` is the quality
  regression metric to compare against once effort does drop.

- [ ] **Step 1: Commit**

```bash
git add -f docs/superpowers/plans/2026-08-09-misdirection-constraints-and-token-headroom.md
git commit
```

Commit `docs/` separately from source: `lint-staged` cannot re-stage ignored paths.
