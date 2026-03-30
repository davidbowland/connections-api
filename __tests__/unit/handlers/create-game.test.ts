import { ScheduledEvent } from 'aws-lambda'

import { connectionsData, gameId } from '../__mocks__'
import eventJson from '@events/create-game.json'
import { createGameHandler } from '@handlers/create-game'
import * as dynamodb from '@services/dynamodb'
import * as games from '@services/games'

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
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

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
      expect(games.createGame).toHaveBeenCalledWith(tomorrow)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should create a game for specified gameId when provided', async () => {
      await createGameHandler(event)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(gameId)
      expect(games.createGame).toHaveBeenCalledWith(gameId)
    })

    it('should not create a game when generation lock is not acquired', async () => {
      jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValueOnce(false)

      await createGameHandler(scheduledEvent)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(tomorrow)
      expect(games.createGame).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should rethrow errors from setGameGenerationStarted', async () => {
      jest
        .mocked(dynamodb)
        .setGameGenerationStarted.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

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

    it('should use resetGameGenerationStarted on attempt 2', async () => {
      await createGameHandler({
        gameId: tomorrow,
        attempt: 2,
        generationStartedAt: GENERATION_STARTED_AT,
      })

      expect(dynamodb.setGameGenerationStarted).not.toHaveBeenCalled()
      expect(dynamodb.resetGameGenerationStarted).toHaveBeenCalledWith(
        tomorrow,
        GENERATION_STARTED_AT,
      )
      expect(games.createGame).toHaveBeenCalledWith(tomorrow)
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
          }),
        }),
      )
    })
  })
})
