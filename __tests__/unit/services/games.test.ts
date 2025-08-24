import { connectionsData, prompt } from '../__mocks__'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import { createGame } from '@services/games'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('games', () => {
  const mockMathRandom = jest.fn().mockReturnValue(0)

  beforeAll(() => {
    jest.mocked(bedrock).invokeModel.mockResolvedValue(connectionsData)
    jest.mocked(dynamodb).getGamesByIds.mockResolvedValue({})
    jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
    jest.mocked(dynamodb).setGameById.mockResolvedValue({} as any)

    Math.random = mockMathRandom
  })

  describe('createGame', () => {
    it('should create a game with word constraint context', async () => {
      const result = await createGame('2025-01-01')

      expect(dynamodb.getGamesByIds).toHaveBeenCalled()
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          disallowedCategories: [],
          wordConstraints: expect.stringContaining('all words must be a country'),
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

    it('should create a game with inspiration context', async () => {
      mockMathRandom.mockReturnValueOnce(1)
      const result = await createGame('2025-01-01')

      expect(dynamodb.getGamesByIds).toHaveBeenCalled()
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          disallowedCategories: [],
          inspirationAdjectives: expect.arrayContaining(['wan', 'balmy']),
          inspirationNouns: expect.arrayContaining(['execution', 'exclusion']),
          inspirationVerbs: expect.arrayContaining(['scratch', 'shiver']),
          wordConstraints: undefined,
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
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: { Cat1: { hint: 'Category hint', words: ['WORD1', 'word1', 'WORD2', 'WORD3'] } },
        wordList: [],
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated words are not unique')
    })

    it('should throw error when wrong number of categories is generated', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated wrong number of categories')
    })

    it('should throw error when a category has wrong number of words', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated a category with the wrong number of words')
    })
  })
})
