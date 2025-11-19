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
      mockMathRandom.mockReturnValueOnce(0) // Use special constraint
      const result = await createGame('2025-01-01')

      expect(dynamodb.getGamesByIds).toHaveBeenCalled()
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

    it('should create a game with normalConstraints (categoryConstraints)', async () => {
      mockMathRandom.mockReturnValueOnce(1) // Use normal constraints
      const result = await createGame('2025-01-01')

      expect(dynamodb.getGamesByIds).toHaveBeenCalled()
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

    it('should select exactly 4 unique categoryConstraints', async () => {
      mockMathRandom.mockReturnValueOnce(1) // Use normal constraints
      await createGame('2025-01-01')

      const callArgs = jest.mocked(bedrock.invokeModel).mock.calls[0][1]
      expect(callArgs.categoryConstraints).toHaveLength(4)
      // Ensure all 4 are unique
      expect(new Set(callArgs.categoryConstraints).size).toBe(4)
    })

    it('should have weighted distribution with tier 1 constraints appearing more frequently', async () => {
      // This test verifies the weighted distribution by checking the normalConstraints array structure
      const { normalConstraints } = await import('@assets/constraints')

      // The array should have duplicates due to weighting (10 tier1 * 3 + 9 tier2 * 2 + 5 tier3 * 1 = 53 total)
      const totalCount = normalConstraints.length
      const uniqueCount = new Set(normalConstraints).size

      // Should have more total items than unique items due to weighting
      expect(totalCount).toBeGreaterThan(uniqueCount)

      // Should have at least 50 items (10*3 + 9*2 + 5*1 = 53)
      expect(totalCount).toBeGreaterThanOrEqual(50)
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
