import { Context, ScheduledEvent } from 'aws-lambda'

import { connectionsData, gameId, generationUsage } from '../__mocks__'
import eventJson from '@events/create-game.json'
import { createGameHandler } from '@handlers/create-game'
import * as dynamodb from '@services/dynamodb'
import * as games from '@services/games'
import * as logging from '@utils/logging'
import * as usage from '@utils/usage'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-lambda', () => ({
  InvokeCommand: jest.fn().mockImplementation((x) => x),
  LambdaClient: jest.fn(() => ({
    send: (...args) => mockSend(...args),
  })),
}))
jest.mock('@services/dynamodb')
jest.mock('@services/games')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}))
jest.mock('@utils/usage')

const tracker = { recordModel: jest.fn(), snapshot: jest.fn() }

const scheduledEvent = {
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
} as ScheduledEvent

const GENERATION_STARTED_AT = 1_000_000_000

describe('create-game', () => {
  const event = eventJson as { gameId?: string }

  const today = '2025-01-05'
  const tomorrow = '2025-01-06'

  beforeAll(() => {
    jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValue(GENERATION_STARTED_AT)
    jest.mocked(dynamodb).resetGameGenerationStarted.mockResolvedValue(GENERATION_STARTED_AT + 1)
    jest.mocked(games).createGame.mockResolvedValue(connectionsData)
    mockSend.mockResolvedValue({})
    tracker.snapshot.mockReturnValue(generationUsage)
    jest.mocked(usage).createUsageTracker.mockReturnValue(tracker)

    jest.useFakeTimers()
    jest.setSystemTime(new Date(today))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('createGameHandler', () => {
    it('should create a game for tomorrow when no gameId provided', async () => {
      await createGameHandler(scheduledEvent)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(tomorrow)
      expect(games.createGame).toHaveBeenCalledWith(tomorrow, tracker)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should create a game for specified gameId when provided', async () => {
      await createGameHandler(event)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(gameId)
      expect(games.createGame).toHaveBeenCalledWith(gameId, tracker)
    })

    it('should not create a game when generation lock is not acquired', async () => {
      jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValueOnce(false)

      await createGameHandler(scheduledEvent)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(tomorrow)
      expect(games.createGame).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should rethrow errors from setGameGenerationStarted', async () => {
      jest.mocked(dynamodb).setGameGenerationStarted.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      await expect(createGameHandler(scheduledEvent)).rejects.toThrow('DynamoDB unavailable')
      expect(games.createGame).not.toHaveBeenCalled()
    })

    it('should invoke self with attempt 2 when creation fails on attempt 1', async () => {
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))

      await createGameHandler(scheduledEvent)

      expect(games.createGame).toHaveBeenCalledTimes(1)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          FunctionName: 'create-game-function',
          InvocationType: 'Event',
          Payload: JSON.stringify({
            gameId: tomorrow,
            attempt: 2,
            generationStartedAt: GENERATION_STARTED_AT,
            usage: generationUsage,
          }),
        }),
      )
    })

    it('should not throw when Lambda self-invocation fails', async () => {
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))
      mockSend.mockRejectedValueOnce(new Error('Lambda invocation failed'))

      await expect(createGameHandler(scheduledEvent)).resolves.toBeUndefined()
    })

    it('should not invoke self when creation fails at max attempt', async () => {
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))

      await createGameHandler({
        gameId: tomorrow,
        attempt: 3,
        generationStartedAt: GENERATION_STARTED_AT,
      })

      expect(games.createGame).toHaveBeenCalledTimes(1)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should log the terminal give-up at error level so the alarm subscription matches', async () => {
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))

      await createGameHandler({
        gameId: tomorrow,
        attempt: 3,
        generationStartedAt: GENERATION_STARTED_AT,
      })

      expect(logging.logError).toHaveBeenCalledWith(
        'Game creation failed at max attempts, giving up',
        expect.objectContaining({ gameId: tomorrow, usage: generationUsage }),
      )
    })

    it('should build the tracker from the Lambda memory limit and prior attempts', async () => {
      await createGameHandler(
        { gameId: tomorrow, attempt: 2, generationStartedAt: GENERATION_STARTED_AT, usage: generationUsage },
        { memoryLimitInMB: '1536' } as Context,
      )

      expect(usage.createUsageTracker).toHaveBeenCalledWith(1536, generationUsage)
    })

    it('should use resetGameGenerationStarted on attempt 2', async () => {
      await createGameHandler({
        gameId: tomorrow,
        attempt: 2,
        generationStartedAt: GENERATION_STARTED_AT,
      })

      expect(dynamodb.setGameGenerationStarted).not.toHaveBeenCalled()
      expect(dynamodb.resetGameGenerationStarted).toHaveBeenCalledWith(tomorrow, GENERATION_STARTED_AT)
      expect(games.createGame).toHaveBeenCalledWith(tomorrow, tracker)
    })

    it('should bail when resetGameGenerationStarted returns false', async () => {
      jest.mocked(dynamodb).resetGameGenerationStarted.mockResolvedValueOnce(false)

      await createGameHandler({
        gameId: tomorrow,
        attempt: 2,
        generationStartedAt: GENERATION_STARTED_AT,
      })

      expect(games.createGame).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should pass updated generationStartedAt in self-invocation on attempt 2 failure', async () => {
      const newTimestamp = GENERATION_STARTED_AT + 1
      jest.mocked(dynamodb).resetGameGenerationStarted.mockResolvedValueOnce(newTimestamp)
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))

      await createGameHandler({
        gameId: tomorrow,
        attempt: 2,
        generationStartedAt: GENERATION_STARTED_AT,
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Payload: JSON.stringify({
            gameId: tomorrow,
            attempt: 3,
            generationStartedAt: newTimestamp,
            usage: generationUsage,
          }),
        }),
      )
    })
  })
})
