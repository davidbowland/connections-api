# connections-api

## General

**Always commit changes** after completing work unless explicitly told not to.

## Testing Standards

**Jest clears all mocks automatically** (`clearMocks: true` in jest.config.ts). Never manually clear mocks.

**Mock state:** Set shared defaults in `beforeAll`. Override per-test with `mockReturnValueOnce` / `mockResolvedValueOnce` / `mockRejectedValueOnce`. Never use `beforeEach` — write a named `setup()` function if repeated arrangement is needed and call it explicitly.

**Non-determinism:** Any function that uses `Date.now()`, `Math.random()`, or `crypto.randomUUID()` to produce a value that affects test outcomes MUST accept it as an injectable parameter with a default:

```ts
// source
export const createThing = (input: Input, now = Date.now): Thing => ({ ...input, createdAt: now() })

// test
it('sets createdAt', () => {
  expect(createThing(input, () => 1_000_000).createdAt).toBe(1_000_000)
})
```

**Fake timers:** Use `jest.useFakeTimers()` in `beforeAll` (and `jest.useRealTimers()` in `afterAll`) when the code under test calls `setTimeout`, `setInterval`, or `Date` internally without injection.

**No CSS or style assertions.** Test observable behavior: return values, thrown errors, calls to collaborators.

**No `if` statements in tests.** No live `Date.now()` or `Math.random()` calls in test bodies. No date arithmetic that depends on the current wall-clock time.

**Deterministic above all.** A test that passes today and fails tomorrow is broken.

## Module Aliases

| Alias         | Path             |
| ------------- | ---------------- |
| `@config`     | `src/config.ts`  |
| `@errors`     | `src/errors.ts`  |
| `@types`      | `src/types.ts`   |
| `@data/*`     | `src/data/*`     |
| `@handlers/*` | `src/handlers/*` |
| `@services/*` | `src/services/*` |
| `@utils/*`    | `src/utils/*`    |

## Commands

- `npm test` — run tests with coverage
- `npm run typecheck` — TypeScript check
- `npm run lint` — format + lint
- `npm start` — run locally via SAM
