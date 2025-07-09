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
  })

  describe('createGame', () => {
    it('should create a game with context', async () => {
      const result = await createGame('2025-01-01')

      expect(dynamodb.getGamesByIds).toHaveBeenCalled()
      expect(bedrock.invokeModel).toHaveBeenCalledWith(prompt, { disallowedCategories: [], disallowedWords: [] })
      expect(dynamodb.setGameById).toHaveBeenCalledWith(
        '2025-01-01',
        expect.objectContaining({ wordList: expect.any(Array) }),
      )
      expect(result).toEqual(expect.objectContaining({ wordList: expect.any(Array) }))
    })

    it('should throw error when words are not unique', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValue({
        categories: { Cat1: { hint: 'Old category hint', words: ['WORD1', 'WORD1', 'WORD2', 'WORD3'] } },
        fakeCategories: {},
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated words are not unique')
    })

    it('should throw error when words overlap with avoid words', async () => {
      jest.mocked(dynamodb).getGamesByIds.mockResolvedValue({
        '2024-12-31': {
          categories: { OldCat: { hint: 'Old category hint', words: ['OVERLAP', 'OLD1', 'OLD2', 'OLD3'] } },
          fakeCategories: {},
          wordList: [],
        },
      })
      jest.mocked(bedrock).invokeModel.mockResolvedValue({
        categories: { Cat1: { hint: 'Old category hint', words: ['OVERLAP', 'NEW1', 'NEW2', 'NEW3'] } },
        fakeCategories: {},
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated words overlap with avoid words')
    })
  })
})
