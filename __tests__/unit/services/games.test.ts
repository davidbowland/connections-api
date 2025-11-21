import { connectionsData, prompt } from '../__mocks__'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import { createGame } from '@services/games'
import * as constraints from '@utils/constraints'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')
jest.mock('@utils/constraints')

describe('games', () => {
  const mockMathRandom = jest.fn().mockReturnValue(0)

  beforeAll(() => {
    jest.mocked(bedrock).invokeModel.mockResolvedValue(connectionsData)
    jest.mocked(dynamodb).getGamesByIds.mockResolvedValue({})
    jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
    jest.mocked(dynamodb).setGameById.mockResolvedValue({} as any)
    jest.mocked(constraints).getDateConstraint.mockReturnValue(undefined)

    Math.random = mockMathRandom
  })

  describe('createGame', () => {
    it('should create a game with specialConstraints (wordConstraints)', async () => {
      const result = await createGame('2025-01-01')

      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          disallowedCategories: [],
          wordConstraints: expect.stringContaining('all words must be 4 letters'),
        }),
      )
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.not.objectContaining({
          categoryConstraints: expect.anything(),
        }),
      )
      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', connectionsData)
      expect(result).toEqual(connectionsData)
    })

    it('should create a game with normalConstraints (categoryConstraints)', async () => {
      mockMathRandom.mockReturnValueOnce(1)
      const result = await createGame('2025-01-01')

      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          categoryConstraints: expect.arrayContaining([expect.stringContaining('Fill in the blank pattern')]),
          disallowedCategories: [],
          inspirationAdjectives: expect.arrayContaining(['wan', 'balmy']),
          inspirationNouns: expect.arrayContaining(['execution', 'exclusion']),
          inspirationVerbs: expect.arrayContaining(['scratch', 'shiver']),
        }),
      )
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.not.objectContaining({
          wordConstraints: expect.anything(),
        }),
      )
      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', connectionsData)
      expect(result).toEqual(connectionsData)
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

    it('should create a game with valid embedded substrings', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { embeddedSubstrings: ['ONE'], hint: 'Category 4 hint', words: ['MONEY', 'PHONE', 'STONE', 'ALONE'] },
        },
        wordList: [],
      })

      const result = await createGame('2025-01-01')

      expect(dynamodb.setGameById).toHaveBeenCalledWith(
        '2025-01-01',
        expect.objectContaining({
          wordList: expect.arrayContaining(['MONEY', 'PHONE', 'STONE', 'ALONE']),
        }),
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['MONEY', 'PHONE', 'STONE', 'ALONE']),
        }),
      )
    })

    it('should throw error when embedded substrings validation fails', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          // POINT doesn't contain ONE
          Cat4: { embeddedSubstrings: ['ONE'], hint: 'Category 4 hint', words: ['MONEY', 'POINT', 'STONE', 'ALONE'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01')).rejects.toThrow('Generated invalid embedded substrings')
    })

    it('should create a game with holiday constraints when date has holiday', async () => {
      jest
        .mocked(constraints)
        .getDateConstraint.mockReturnValueOnce(
          'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
        )

      const result = await createGame('2025-10-31')

      expect(constraints.getDateConstraint).toHaveBeenCalledWith(new Date('2025-10-31'))
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          disallowedCategories: [],
          wordConstraints:
            'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
        }),
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT']),
        }),
      )
    })

    it('should fall back to specialConstraints when no holiday constraint exists', async () => {
      jest.mocked(constraints).getDateConstraint.mockReturnValueOnce(undefined)
      mockMathRandom.mockReturnValueOnce(0) // Ensure we get a special constraint

      const result = await createGame('2025-06-15')

      expect(constraints.getDateConstraint).toHaveBeenCalledWith(new Date('2025-06-15'))
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          disallowedCategories: [],
          wordConstraints: expect.stringContaining('always generate 5 categories'),
        }),
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT']),
        }),
      )
    })

    it('should fall back to normalConstraints when no holiday constraint exists', async () => {
      jest.mocked(constraints).getDateConstraint.mockReturnValueOnce(undefined)
      mockMathRandom.mockReturnValueOnce(1) // Ensure we get normal constraints

      const result = await createGame('2025-06-15')

      expect(constraints.getDateConstraint).toHaveBeenCalledWith(new Date('2025-06-15'))
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({
          categoryConstraints: expect.any(Array),
          disallowedCategories: [],
        }),
      )
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        expect.not.objectContaining({
          wordConstraints: expect.anything(),
        }),
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT']),
        }),
      )
    })
  })
})
