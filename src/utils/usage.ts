import { GenerationUsage, ModelTokenUsage } from '../types'

// USD per million tokens, keyed by the model ID with any Bedrock region/vendor prefix and version
// suffix stripped. These are Anthropic's list prices. Bedrock bills Claude itself, and its us.*
// cross-region profiles can carry different rates, so check https://aws.amazon.com/bedrock/pricing/
// before trusting the logged costs to the cent. cacheWrite is the 5-minute-TTL write rate.
const MODEL_PRICING_PER_MTOK: Record<string, { cacheRead: number; cacheWrite: number; input: number; output: number }> =
  {
    'claude-opus-5': { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
    'claude-opus-5-5': { cacheRead: 0.2, cacheWrite: 5, input: 4, output: 20 },
  }

// Lambda x86_64 duration price in us-east-1. Request charges ($0.20/M) are too small to matter here.
const LAMBDA_USD_PER_GB_SECOND = 0.0000166667

// The shape of the `usage` object in an Anthropic Messages response body. Every field is optional
// because the cache fields are omitted when no caching happened, and a malformed body must not throw.
export interface RawModelUsage {
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

export interface UsageClock {
  cpuUsage: () => { system: number; user: number }
  maxRssKb: () => number
  now: () => number
}

export interface UsageTracker {
  recordModel: (model: string, usage: RawModelUsage | undefined) => void
  snapshot: () => GenerationUsage
}

const defaultClock: UsageClock = {
  cpuUsage: () => process.cpuUsage(),
  // Peak RSS for the whole process, so on a warm container it can reflect an earlier invocation.
  maxRssKb: () => process.resourceUsage().maxRSS,
  now: Date.now,
}

const roundTo = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places

const baseModelId = (model: string): string => (model.split('anthropic.').pop() as string).split(':')[0]

type TokenCounts = Pick<ModelTokenUsage, 'input' | 'inputCacheWrite' | 'inputCached' | 'output'>

export const modelCostUsd = (model: string, tokens: TokenCounts): number | undefined => {
  const pricing = MODEL_PRICING_PER_MTOK[baseModelId(model)]
  if (!pricing) {
    return undefined
  }
  const cost =
    tokens.input * pricing.input +
    tokens.output * pricing.output +
    tokens.inputCached * pricing.cacheRead +
    tokens.inputCacheWrite * pricing.cacheWrite
  return roundTo(cost / 1_000_000, 6)
}

export const toTokenCounts = (usage: RawModelUsage | undefined): TokenCounts => ({
  input: usage?.input_tokens ?? 0,
  inputCached: usage?.cache_read_input_tokens ?? 0,
  inputCacheWrite: usage?.cache_creation_input_tokens ?? 0,
  output: usage?.output_tokens ?? 0,
})

// One tracker per Lambda invocation. `prior` is the usage accumulated by earlier attempts at the same
// game (carried in the self-invoke retry payload), so the stored figures cover every attempt the game
// cost, not just the one that succeeded.
export const createUsageTracker = (
  memoryLimitMb: number,
  prior?: GenerationUsage,
  clock: UsageClock = defaultClock,
): UsageTracker => {
  const startedAt = clock.now()
  const cpuStart = clock.cpuUsage()
  const tokens = new Map<string, ModelTokenUsage>((prior?.tokens ?? []).map((entry) => [entry.model, { ...entry }]))

  const recordModel = (model: string, usage: RawModelUsage | undefined): void => {
    const counts = toTokenCounts(usage)
    const entry = tokens.get(model) ?? {
      input: 0,
      inputCacheWrite: 0,
      inputCached: 0,
      invocations: 0,
      model,
      output: 0,
    }
    tokens.set(model, {
      ...entry,
      input: entry.input + counts.input,
      inputCacheWrite: entry.inputCacheWrite + counts.inputCacheWrite,
      inputCached: entry.inputCached + counts.inputCached,
      invocations: entry.invocations + 1,
      output: entry.output + counts.output,
    })
  }

  const snapshot = (): GenerationUsage => {
    const cpuNow = clock.cpuUsage()
    const attemptWallClockMs = clock.now() - startedAt
    const attemptCpuMs = (cpuNow.user - cpuStart.user + cpuNow.system - cpuStart.system) / 1000
    const gbSeconds = (prior?.gbSeconds ?? 0) + (attemptWallClockMs / 1000) * (memoryLimitMb / 1024)

    const tokenList = [...tokens.values()].map((entry): ModelTokenUsage => {
      const { costUsd: _stale, ...counts } = entry
      const costUsd = modelCostUsd(entry.model, counts)
      return costUsd === undefined ? counts : { ...counts, costUsd }
    })
    const lambdaCostUsd = roundTo(gbSeconds * LAMBDA_USD_PER_GB_SECOND, 6)
    const modelsCostUsd = roundTo(
      tokenList.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0),
      6,
    )

    return {
      attempts: (prior?.attempts ?? 0) + 1,
      costUsd: { lambda: lambdaCostUsd, models: modelsCostUsd, total: roundTo(lambdaCostUsd + modelsCostUsd, 6) },
      cpuMs: roundTo((prior?.cpuMs ?? 0) + attemptCpuMs, 0),
      gbSeconds: roundTo(gbSeconds, 3),
      maxMemoryMb: Math.max(prior?.maxMemoryMb ?? 0, roundTo(clock.maxRssKb() / 1024, 0)),
      memoryLimitMb,
      tokens: tokenList,
      wallClockMs: (prior?.wallClockMs ?? 0) + attemptWallClockMs,
    }
  }

  return { recordModel, snapshot }
}
