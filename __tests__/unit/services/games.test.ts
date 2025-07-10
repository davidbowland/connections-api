import { connectionsData, prompt } from '../__mocks__'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import { createGame } from '@services/games'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('games', () => {
  beforeAll(() => {
    jest.mocked(dynamodb).getGamesByIds.mockResolvedValue({})
    jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
    jest.mocked(bedrock).invokeModel.mockResolvedValue(connectionsData)
    jest.mocked(dynamodb).setGameById.mockResolvedValue({} as any)

    Math.random = jest.fn().mockReturnValue(0)
  })

  describe('createGame', () => {
    it('should create a game with context', async () => {
      const result = await createGame('2025-01-01')

      expect(dynamodb.getGamesByIds).toHaveBeenCalled()
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          disallowedCategories: [],
          inspirationAdjectives: expect.arrayContaining(['good', 'balmy', 'wan']),
          inspirationNouns: expect.arrayContaining([
            'time',
            'execution',
            'exclusion',
            'engagement',
            'dismissal',
            'disappointment',
            'diamond',
            'deck',
            'counterpart',
            'contest',
          ]),
          inspirationVerbs: expect.arrayContaining(['be', 'shiver', 'scratch', 'scan', 'rip', 'revise']),
        }),
      )
      expect(dynamodb.setGameById).toHaveBeenCalledWith(
        '2025-01-01',
        expect.objectContaining({
          wordList: expect.arrayContaining([
            'BLUSTER',
            'CROW',
            'SHOW OFF',
            'STRUT',
            'BANANA',
            'EYEBROW',
            'FLIGHT PATH',
            'RAINBOW',
            'COUNT',
            'ELVES',
          ]),
        }),
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining([
            'BLUSTER',
            'CROW',
            'SHOW OFF',
            'STRUT',
            'BANANA',
            'EYEBROW',
            'FLIGHT PATH',
            'RAINBOW',
            'COUNT',
            'ELVES',
          ]),
        }),
      )
    })

    it('should throw error when words are not unique', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValue({
        categories: { Cat1: { hint: 'Category hint', words: ['WORD1', 'WORD1', 'WORD2', 'WORD3'] } },
        wordList: [],
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated words are not unique')
    })
  })
})
