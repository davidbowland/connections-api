import { GenerationUsage } from '@types'
import { createUsageTracker, modelCostUsd, UsageClock } from '@utils/usage'

describe('usage', () => {
  const opus55 = 'us.anthropic.claude-opus-5-5'

  // Two clock reads: tracker creation, then snapshot 2s later. CPU moves by 50ms user + 10ms system.
  const setup = (): UsageClock => ({
    cpuUsage: jest
      .fn()
      .mockReturnValueOnce({ system: 500, user: 1_000 })
      .mockReturnValueOnce({ system: 10_500, user: 51_000 }),
    maxRssKb: jest.fn().mockReturnValueOnce(262_144),
    now: jest.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(3_000),
  })

  describe('modelCostUsd', () => {
    it('should price every token kind for a known model', () => {
      expect(modelCostUsd(opus55, { input: 1_000, inputCacheWrite: 10, inputCached: 100, output: 2_000 })).toBe(0.04407)
    })

    it('should match a model ID with a Bedrock version suffix', () => {
      expect(
        modelCostUsd('anthropic.claude-opus-5:0', { input: 1_000, inputCacheWrite: 0, inputCached: 0, output: 0 }),
      ).toBe(0.005)
    })

    it('should return undefined for a model with no pricing', () => {
      expect(
        modelCostUsd('the-thinking-ai:1.0', { input: 1, inputCacheWrite: 0, inputCached: 0, output: 1 }),
      ).toBeUndefined()
    })
  })

  describe('createUsageTracker', () => {
    it('should total tokens per model and measure the attempt', () => {
      const tracker = createUsageTracker(1536, undefined, setup())
      tracker.recordModel(opus55, { cache_read_input_tokens: 100, input_tokens: 600, output_tokens: 1_500 })
      tracker.recordModel(opus55, { cache_creation_input_tokens: 10, input_tokens: 400, output_tokens: 500 })

      expect(tracker.snapshot()).toEqual({
        attempts: 1,
        costUsd: { lambda: 0.00005, models: 0.04407, total: 0.04412 },
        cpuMs: 60,
        gbSeconds: 3,
        maxMemoryMb: 256,
        memoryLimitMb: 1536,
        tokens: [
          {
            costUsd: 0.04407,
            input: 1_000,
            inputCacheWrite: 10,
            inputCached: 100,
            invocations: 2,
            model: opus55,
            output: 2_000,
          },
        ],
        wallClockMs: 2_000,
      })
    })

    it('should add this attempt onto usage from earlier attempts', () => {
      const prior: GenerationUsage = {
        attempts: 1,
        costUsd: { lambda: 0.000025, models: 0.004, total: 0.004025 },
        cpuMs: 40,
        gbSeconds: 1.5,
        maxMemoryMb: 300,
        memoryLimitMb: 1536,
        tokens: [
          {
            costUsd: 0.004,
            input: 500,
            inputCacheWrite: 0,
            inputCached: 0,
            invocations: 1,
            model: opus55,
            output: 100,
          },
        ],
        wallClockMs: 1_000,
      }
      const tracker = createUsageTracker(1536, prior, setup())
      tracker.recordModel('us.anthropic.claude-opus-5', { input_tokens: 1_000, output_tokens: 1_000 })

      expect(tracker.snapshot()).toEqual(
        expect.objectContaining({
          attempts: 2,
          costUsd: { lambda: 0.000075, models: 0.034, total: 0.034075 },
          cpuMs: 100,
          gbSeconds: 4.5,
          maxMemoryMb: 300,
          tokens: [
            expect.objectContaining({ costUsd: 0.004, invocations: 1, model: opus55 }),
            expect.objectContaining({ costUsd: 0.03, invocations: 1, model: 'us.anthropic.claude-opus-5' }),
          ],
          wallClockMs: 3_000,
        }),
      )
    })

    it('should count an invocation with no usage and leave an unpriced model without a cost', () => {
      const tracker = createUsageTracker(1536, undefined, setup())
      tracker.recordModel('the-thinking-ai:1.0', undefined)

      const snapshot = tracker.snapshot()

      expect(snapshot.tokens).toEqual([
        { input: 0, inputCacheWrite: 0, inputCached: 0, invocations: 1, model: 'the-thinking-ai:1.0', output: 0 },
      ])
      expect(snapshot.costUsd.models).toBe(0)
    })
  })
})
