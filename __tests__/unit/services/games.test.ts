import { connectionsData, generationUsage, prompt } from '../__mocks__'
import { adjectives } from '@assets/adjectives'
import {
  alwaysDisallowedCategories,
  constraintModifiers,
  tier1CategoryConstraints,
  tier2CategoryConstraints,
  tier3CategoryConstraints,
  wildcardConstraint,
} from '@assets/constraints'
import { nouns } from '@assets/nouns'
import { verbs } from '@assets/verbs'
import { disallowedCategoryLimit } from '@config'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import {
  buildCategoryHistory,
  checkGeneratedGame,
  createGame,
  finalizeVerifiedGame,
  findChargedTerm,
  gameTool,
  normalizeSearches,
  validateGame,
} from '@services/games'
import * as verification from '@services/verification'
import * as constraints from '@utils/constraints'
import { log } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')
jest.mock('@utils/constraints')
jest.mock('@services/verification')

describe('games', () => {
  const mockMathRandom = jest.fn().mockReturnValue(0)

  // The tool schema makes decoys required, so the shape the model actually returns is the shared
  // fixture plus decoys. Kept local rather than added to the shared connectionsData because decoys
  // are never part of a stored game -- the assertions that the stored value equals the bare
  // connectionsData are what prove they get dropped.
  const generatedGame = {
    ...connectionsData,
    decoys: [
      { looksLike: 'Cereal mascots', word: 'CROW' },
      { looksLike: 'Ways to denote a citation', word: 'COUNT' },
      { looksLike: 'Boast', word: 'DAGGER' },
    ],
  }

  beforeAll(() => {
    jest.mocked(bedrock).invokeModel.mockResolvedValue(generatedGame)
    jest.mocked(dynamodb).getAllGames.mockResolvedValue({})
    jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
    jest.mocked(dynamodb).setGameById.mockResolvedValue({} as any)
    jest.mocked(constraints).getDateConstraint.mockReturnValue(undefined)
    jest.mocked(verification).verifyAndFixGame.mockImplementation(async (g) => g)
  })

  describe('createGame', () => {
    it('should create a game with specialConstraints (wordConstraints)', async () => {
      const result = await createGame('2025-01-01', undefined, mockMathRandom)

      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.objectContaining({
          disallowedCategories: alwaysDisallowedCategories,
          wordConstraints: expect.stringContaining('all words must be 4 letters'),
        }),
        undefined,
      )
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.not.objectContaining({
          categoryConstraints: expect.anything(),
        }),
        undefined,
      )
      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', connectionsData, undefined)
      expect(result).toEqual(connectionsData)
    })

    it('should create a game with normalConstraints (categoryConstraints)', async () => {
      mockMathRandom.mockReturnValueOnce(1)
      const result = await createGame('2025-01-01', undefined, mockMathRandom)

      // Every roll after the forced word-constraint miss is 0, so selectCategoryConstraints takes
      // the wildcard slot (0 < WILDCARD_SLOT_CHANCE), applies the first modifier to the first
      // ordinary slot, and fills the rest with distinct tier 1 patterns.
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.objectContaining({
          categoryConstraints: [
            wildcardConstraint,
            `${tier1CategoryConstraints[0]} ${constraintModifiers[0]}`,
            tier1CategoryConstraints[1],
            tier1CategoryConstraints[2],
          ],
          disallowedCategories: alwaysDisallowedCategories,
          // Derived from the lists rather than hardcoded. With random mocked to 0, getRandomSample
          // returns array[0] and then the entry it swapped in from the tail -- so asserting the
          // first and last words proves the sampler reaches into the list AND performs the
          // swap-to-tail. Hardcoding the words instead would break this service test on every
          // regeneration of an asset file it has nothing to do with.
          inspirationAdjectives: expect.arrayContaining([adjectives[0], adjectives[adjectives.length - 1]]),
          inspirationNouns: expect.arrayContaining([nouns[0], nouns[nouns.length - 1]]),
          inspirationVerbs: expect.arrayContaining([verbs[0], verbs[verbs.length - 1]]),
        }),
        undefined,
      )
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.not.objectContaining({
          wordConstraints: expect.anything(),
        }),
        undefined,
      )
      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', connectionsData, undefined)
      expect(result).toEqual(connectionsData)
    })

    it('should request exactly four category constraints', async () => {
      mockMathRandom.mockReturnValueOnce(1)

      await createGame('2025-01-01', undefined, mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.categoryConstraints).toHaveLength(4)
    })

    // Regression guard for the flat-pool shim getModelContext used to sample: every emitted slot
    // must trace back to a tier array or to one of the special slot texts, and the slots must be
    // distinct. A uniform draw over a concatenated pool would satisfy neither the wildcard nor the
    // modifier assertion below.
    it('should draw every category constraint from the weighted tier pools', async () => {
      mockMathRandom.mockReturnValueOnce(1)

      await createGame('2025-01-01', undefined, mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      const knownPatterns = [
        wildcardConstraint,
        ...tier1CategoryConstraints,
        ...tier2CategoryConstraints,
        ...tier3CategoryConstraints,
      ]
      const recognized = (context.categoryConstraints as string[]).filter((constraint) =>
        knownPatterns.some((pattern) => constraint.startsWith(pattern)),
      )

      expect(recognized).toEqual(context.categoryConstraints)
      expect(new Set(context.categoryConstraints as string[]).size).toEqual(4)
    })

    it('should emit the wildcard and modifier slots the weighted selection produces', async () => {
      mockMathRandom.mockReturnValueOnce(1)

      await createGame('2025-01-01', undefined, mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.categoryConstraints[0]).toEqual(wildcardConstraint)
      expect(context.categoryConstraints[1]).toEqual(`${tier1CategoryConstraints[0]} ${constraintModifiers[0]}`)
    })

    it('should pass always-disallowed categories plus the recent categories from game history', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce({
        '2024-12-31': {
          categories: {
            'Previous Category 1': { hint: 'hint', words: ['A', 'B', 'C', 'D'] },
            'Previous Category 2': { hint: 'hint', words: ['E', 'F', 'G', 'H'] },
          },
          wordList: [],
        },
      })

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.objectContaining({
          disallowedCategories: [...alwaysDisallowedCategories, 'Previous Category 1', 'Previous Category 2'],
        }),
        undefined,
      )
    })

    it('should throw error when words are not unique', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category hint', words: ['WORD1', 'word1', 'WORD2', 'WORD3'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated words are not unique',
      )
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

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated wrong number of categories',
      )
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

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated a category with the wrong number of words',
      )
    })

    it('should store and log the usage snapshot and pass the tracker to both model calls', async () => {
      const tracker = { recordModel: jest.fn(), snapshot: jest.fn().mockReturnValueOnce(generationUsage) }

      await createGame('2025-01-01', tracker, mockMathRandom)

      expect(bedrock.invokeModel).toHaveBeenCalledWith(prompt, gameTool, expect.anything(), tracker)
      expect(verification.verifyAndFixGame).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        tracker,
      )
      expect(log).toHaveBeenCalledWith('Game generation usage', { gameId: '2025-01-01', usage: generationUsage })
      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', connectionsData, generationUsage)
    })

    it('should create a game with valid embedded substrings', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: {
            embeddedSubstrings: ['ONE'],
            hint: 'Category 4 hint',
            words: ['MONEY', 'PHONE', 'STONE', 'ALONE'],
          },
        },
        decoys: [
          { looksLike: 'Cat2', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
        wordList: [],
      })

      const result = await createGame('2025-01-01', undefined, mockMathRandom)

      expect(dynamodb.setGameById).toHaveBeenCalledWith(
        '2025-01-01',
        expect.objectContaining({
          wordList: expect.arrayContaining(['MONEY', 'PHONE', 'STONE', 'ALONE']),
        }),
        undefined,
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
          Cat4: {
            embeddedSubstrings: ['ONE'],
            hint: 'Category 4 hint',
            words: ['MONEY', 'POINT', 'STONE', 'ALONE'],
          },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated invalid embedded substrings',
      )
    })

    it('should create a game with holiday constraints when date has holiday', async () => {
      jest
        .mocked(constraints)
        .getDateConstraint.mockReturnValueOnce(
          'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
        )

      const result = await createGame('2025-10-31', undefined, mockMathRandom)

      expect(constraints.getDateConstraint).toHaveBeenCalledWith(new Date('2025-10-31'))
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.objectContaining({
          disallowedCategories: alwaysDisallowedCategories,
          wordConstraints:
            'all words must be related to Halloween, but categories are NOT required to be Halloween-related',
        }),
        undefined,
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT']),
        }),
      )
    })

    it('should fall back to specialConstraints when no holiday constraint exists', async () => {
      jest.mocked(constraints).getDateConstraint.mockReturnValueOnce(undefined)

      const result = await createGame('2025-06-15', undefined, mockMathRandom)

      expect(constraints.getDateConstraint).toHaveBeenCalledWith(new Date('2025-06-15'))
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.objectContaining({
          disallowedCategories: alwaysDisallowedCategories,
          wordConstraints: expect.stringContaining('all words must be 4 letters'),
        }),
        undefined,
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT']),
        }),
      )
    })

    it('should fall back to normalConstraints when no holiday constraint exists', async () => {
      jest.mocked(constraints).getDateConstraint.mockReturnValueOnce(undefined)
      mockMathRandom.mockReturnValueOnce(1) // Force normal constraints

      const result = await createGame('2025-06-15', undefined, mockMathRandom)

      expect(constraints.getDateConstraint).toHaveBeenCalledWith(new Date('2025-06-15'))
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.objectContaining({
          categoryConstraints: expect.any(Array),
          disallowedCategories: alwaysDisallowedCategories,
        }),
        undefined,
      )
      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        gameTool,
        expect.not.objectContaining({
          wordConstraints: expect.anything(),
        }),
        undefined,
      )
      expect(result).toEqual(
        expect.objectContaining({
          wordList: expect.arrayContaining(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT']),
        }),
      )
    })

    it('should throw when post-fix validateGame fails', async () => {
      jest.mocked(verification).verifyAndFixGame.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD1', 'WORD13', 'WORD14', 'WORD15'] },
        },
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated words are not unique',
      )
    })

    it('should throw when a category word is a charged term', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['BASTARD', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow('Generated a charged term')
    })

    it('should throw when a category name contains a charged term', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          'Bastard behavior': { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow('Generated a charged term')
    })

    it('should not reject words that merely contain a charged term as a substring', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['ASSESS', 'COCKTAIL', 'SCUNTHORPE', 'CLASSIC'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        decoys: [
          { looksLike: 'Cat2', word: 'ASSESS' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
        wordList: [],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).resolves.toBeDefined()
    })

    // GameIds are ISO dates and the model-visible window is a descending string sort, so index 0
    // is the OLDEST entry -- the first one to drop out of that window as history grows.
    const historicalGameId = (index: number): string =>
      new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString().slice(0, 10)

    const buildGameHistory = (names: string[]): Record<string, any> =>
      Object.fromEntries(
        names.map((name, index) => [
          historicalGameId(index),
          { categories: { [name]: { hint: 'hint', words: ['A', 'B', 'C', 'D'] } }, wordList: [] },
        ]),
      )

    // Distinct from every mocked game category and from alwaysDisallowedCategories, so padding the
    // history with these never changes whether a test's real fixture matches.
    const paddingCategoryNames = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => `Historical category ${index}`)

    it('should throw when a generated category exactly repeats one from history', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(buildGameHistory(['Boast!']))

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated a repeated category: Boast',
      )
    })

    it('should throw when a generated category is a reordered paraphrase of one from history', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(buildGameHistory(['Mascots of cereal']))

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated a repeated category: Cereal mascots',
      )
    })

    it('should throw when a generated category repeats an always-disallowed category', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          'Spice Girls': { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated a repeated category: Spice Girls',
      )
    })

    it('should throw when the verifier introduces a repeated category', async () => {
      jest.mocked(verification).verifyAndFixGame.mockResolvedValueOnce({
        categories: {
          Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          'Homophones of body parts': { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated a repeated category: Homophones of body parts',
      )
    })

    it('should cap the model-visible disallowed categories at the always-disallowed list plus the limit', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(buildGameHistory(paddingCategoryNames(600)))

      await createGame('2025-01-01', undefined, mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.disallowedCategories).toHaveLength(alwaysDisallowedCategories.length + disallowedCategoryLimit)
    })

    it('should always send the always-disallowed categories even when history overflows the limit', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(buildGameHistory(paddingCategoryNames(600)))

      await createGame('2025-01-01', undefined, mockMathRandom)

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.disallowedCategories.slice(0, alwaysDisallowedCategories.length)).toEqual(
        alwaysDisallowedCategories,
      )
    })

    // The code-level check and the prompt list share one window on purpose. Rejecting a name the
    // model was never shown is a trap -- it cannot avoid what it was not told about, and the
    // generation dies with no way for it to have done better. Falling out of the window means
    // falling out of BOTH, so a rejection always corresponds to a warning the model was given.
    it('should not reject a repeat that has aged out of the model-visible window', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(buildGameHistory(['Boast', ...paddingCategoryNames(599)]))

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).resolves.toBeDefined()

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.disallowedCategories).not.toContain('Boast')
    })

    it('should reject two categories in the same game that key to the same name', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        categories: {
          'Green things': { hint: 'h', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
          'Things that are green': { hint: 'h', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
          Cat3: { hint: 'h', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
          Cat4: { hint: 'h', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
        },
        wordList: [],
      } as any)

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow('Generated a repeated category')
    })

    it('should reject a repeat that is still inside the model-visible window', async () => {
      jest.mocked(dynamodb).getAllGames.mockResolvedValueOnce(buildGameHistory(['Boast', ...paddingCategoryNames(10)]))

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Generated a repeated category: Boast',
      )

      const context = jest.mocked(bedrock).invokeModel.mock.calls[0][2] as Record<string, any>
      expect(context.disallowedCategories).toContain('Boast')
    })

    const decoyGame = {
      categories: {
        Cat1: { hint: 'Category 1 hint', words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'] },
        Cat2: { hint: 'Category 2 hint', words: ['WORD5', 'WORD6', 'WORD7', 'WORD8'] },
        Cat3: { hint: 'Category 3 hint', words: ['WORD9', 'WORD10', 'WORD11', 'WORD12'] },
        Cat4: { hint: 'Category 4 hint', words: ['WORD13', 'WORD14', 'WORD15', 'WORD16'] },
      },
      wordList: [],
    }

    // Owners are Cat1, Cat2, Cat3 and the targets are Cat2, Cat3, Cat1, so the union over both
    // endpoints is three categories.
    const spreadDecoys = [
      { looksLike: 'Cat2', word: 'WORD1' },
      { looksLike: 'Cat3', word: 'WORD5' },
      { looksLike: 'Cat1', word: 'WORD9' },
    ]

    it('should require decoys in the submit_game schema', () => {
      expect(gameTool.input_schema.required).toContain('decoys')
      expect(gameTool.input_schema.properties.decoys).toEqual(expect.objectContaining({ minItems: 3, type: 'array' }))
      // Deliberately no maxItems: ajv validates this schema against every model payload, so a
      // ceiling here would discard a game for carrying MORE misdirection than asked for.
      expect(gameTool.input_schema.properties.decoys.maxItems).toBeUndefined()
    })

    it('should accept a game with three well-spread decoys', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({ ...decoyGame, decoys: spreadDecoys })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).resolves.toBeDefined()
    })

    it('should throw when the model omits decoys entirely', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(decoyGame)

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow('Generated too few decoys: 0')
    })

    it('should throw when there are too few decoys', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow('Generated too few decoys: 2')
    })

    it('should accept more decoys than the schema suggests rather than discarding the game', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          ...spreadDecoys,
          { looksLike: 'Cat4', word: 'WORD2' },
          { looksLike: 'Cat1', word: 'WORD6' },
          { looksLike: 'Cat2', word: 'WORD10' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).resolves.toBeDefined()
    })

    // The whole point of the spread rule: three decoys that only ever touch Cat1 and Cat2 leave
    // Cat3 and Cat4 completely unambiguous.
    it('should throw when decoys are concentrated in one pair of categories', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'WORD1' },
          { looksLike: 'Cat2', word: 'WORD2' },
          { looksLike: 'Cat1', word: 'WORD5' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Decoys must span at least 3 categories',
      )
    })

    it('should throw when a decoy names a word that is not in the grid', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'NOTHERE' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Decoy references unknown word: NOTHERE',
      )
    })

    it('should throw when a decoy names a category that is not in the grid', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat9', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Decoy references unknown category: Cat9',
      )
    })

    it('should throw when a decoy points at its own category', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat1', word: 'WORD1' },
          { looksLike: 'Cat3', word: 'WORD5' },
          { looksLike: 'Cat1', word: 'WORD9' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow(
        'Decoy points at its own category: WORD1',
      )
    })

    it('should match decoy words case-insensitively against the grid', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({
        ...decoyGame,
        decoys: [
          { looksLike: 'Cat2', word: 'word1' },
          { looksLike: 'Cat3', word: 'word5' },
          { looksLike: 'Cat1', word: 'word9' },
        ],
      })

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).resolves.toBeDefined()
    })

    it('should pass the decoys to the verifier as a separate argument', async () => {
      const decoys = [
        { looksLike: 'Cat2', word: 'WORD1' },
        { looksLike: 'Cat3', word: 'WORD5' },
        { looksLike: 'Cat1', word: 'WORD9' },
      ]
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({ ...decoyGame, decoys } as any)

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(jest.mocked(verification).verifyAndFixGame.mock.calls[0][2]).toEqual(decoys)
    })

    it('should not persist decoys on the stored game', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({ ...decoyGame, decoys: spreadDecoys })

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(Object.keys(jest.mocked(dynamodb).setGameById.mock.calls[0][1])).not.toContain('decoys')
    })

    it('should not return decoys from createGame', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({ ...decoyGame, decoys: spreadDecoys })

      const result = await createGame('2025-01-01', undefined, mockMathRandom)

      expect(Object.keys(result)).not.toContain('decoys')
    })

    it('should not merge decoys into the game object handed to the verifier', async () => {
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce({ ...decoyGame, decoys: spreadDecoys })

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(Object.keys(jest.mocked(verification).verifyAndFixGame.mock.calls[0][0])).not.toContain('decoys')
    })

    it('should name the constraint branch the word-constraint roll selected', async () => {
      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(log).toHaveBeenCalledWith('Constraint chance', expect.objectContaining({ branch: 'word' }))
    })

    it('should name the category branch when the word-constraint roll misses', async () => {
      mockMathRandom.mockReturnValueOnce(1)

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(log).toHaveBeenCalledWith('Constraint chance', expect.objectContaining({ branch: 'category' }))
    })

    it('should name the holiday branch when the date carries a constraint', async () => {
      jest.mocked(constraints).getDateConstraint.mockReturnValueOnce('all words must be festive')

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(log).toHaveBeenCalledWith('Constraint chance', expect.objectContaining({ branch: 'holiday' }))
    })

    it('should log the generated categories next to the constraints that produced them', async () => {
      mockMathRandom.mockReturnValueOnce(1)

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(log).toHaveBeenCalledWith(
        'Generated game',
        expect.objectContaining({
          categories: [
            'Boast: Boast hint',
            'Arc-shaped things: Arc-shaped things hint',
            'Cereal mascots: Cereal mascots hint',
            'Ways to denote a citation: Ways to denote a citation hint',
          ],
          categoryConstraints: expect.arrayContaining([wildcardConstraint]),
          decoyCount: 3,
          gameId: '2025-01-01',
          verifierChangedGame: false,
          wildcardSlot: true,
        }),
      )
    })

    it('should log the word constraint rather than a wildcard slot on the word branch', async () => {
      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(log).toHaveBeenCalledWith(
        'Generated game',
        expect.objectContaining({
          categoryConstraints: undefined,
          wildcardSlot: false,
          wordConstraints: expect.stringContaining('all words must be 4 letters'),
        }),
      )
    })

    it('should report the pre-verification categories and that the verifier changed them', async () => {
      jest.mocked(verification).verifyAndFixGame.mockResolvedValueOnce({
        categories: {
          ...connectionsData.categories,
          Boast: { hint: 'Replaced hint', words: ['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT'] },
        },
      })

      await createGame('2025-01-01', undefined, mockMathRandom)

      expect(log).toHaveBeenCalledWith(
        'Generated game',
        expect.objectContaining({
          categories: expect.arrayContaining(['Boast: Replaced hint']),
          generatedCategories: expect.arrayContaining(['Boast: Boast hint']),
          verifierChangedGame: true,
        }),
      )
    })

    it('should log the constraints in play when generation fails', async () => {
      mockMathRandom.mockReturnValueOnce(1)
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(decoyGame)

      await expect(createGame('2025-01-01', undefined, mockMathRandom)).rejects.toThrow()

      expect(log).toHaveBeenCalledWith(
        'Game generation failed',
        expect.objectContaining({
          categoryConstraints: expect.arrayContaining([wildcardConstraint]),
          gameId: '2025-01-01',
          message: 'Generated too few decoys: 0',
        }),
      )
    })
  })

  // Search phrases are model output that rides to the client inside the category, so every one is
  // treated as untrusted: a bad entry is dropped (the UI falls back to the bare word) rather than
  // failing a whole generation over a link.
  describe('searches', () => {
    // bedrock is mocked for the rest of this file; schema validation needs the real ajv path.
    const { validateResponse } = jest.requireActual<typeof bedrock>('@services/bedrock')

    const fishCategory = { hint: 'Gone fishing?', words: ['BASS', 'PIKE', 'PERCH', 'CARP'] }

    describe('normalizeSearches', () => {
      it('should return a category with no searches key when the input has none', () => {
        expect(Object.keys(normalizeSearches(fishCategory))).not.toContain('searches')
      })

      it('should return a category with no searches key when searches is not a plain object', () => {
        const result = normalizeSearches({ ...fishCategory, searches: ['bass fish'] as any })

        expect(Object.keys(result)).not.toContain('searches')
      })

      it('should return a category with no searches key when every entry is invalid', () => {
        const result = normalizeSearches({
          ...fishCategory,
          searches: { BASS: '   ', GUITAR: 'bass guitar', PIKE: 42 as any },
        })

        expect(Object.keys(result)).not.toContain('searches')
      })

      it('should uppercase keys so they match the words', () => {
        const result = normalizeSearches({ ...fishCategory, searches: { bass: 'bass fish', Pike: 'pike fish' } })

        expect(result.searches).toEqual({ BASS: 'bass fish', PIKE: 'pike fish' })
      })

      it('should keep the last valid entry when two keys collide after uppercasing', () => {
        const result = normalizeSearches({
          ...fishCategory,
          searches: { bass: 'bass guitar', BASS: 'bass fish', Bass: '' },
        })

        expect(result.searches).toEqual({ BASS: 'bass fish' })
      })

      it('should trim phrases', () => {
        const result = normalizeSearches({ ...fishCategory, searches: { BASS: '  bass fish \n' } })

        expect(result.searches).toEqual({ BASS: 'bass fish' })
      })

      it('should drop entries whose key is not one of the words', () => {
        const result = normalizeSearches({ ...fishCategory, searches: { BASS: 'bass fish', TROUT: 'trout fish' } })

        expect(result.searches).toEqual({ BASS: 'bass fish' })
      })

      it('should drop entries whose value is not a string', () => {
        const result = normalizeSearches({
          ...fishCategory,
          searches: { BASS: 'bass fish', CARP: null as any, PIKE: { q: 'pike' } as any },
        })

        expect(result.searches).toEqual({ BASS: 'bass fish' })
      })

      it('should drop entries that are blank after trimming', () => {
        const result = normalizeSearches({ ...fishCategory, searches: { BASS: 'bass fish', PIKE: ' \t ' } })

        expect(result.searches).toEqual({ BASS: 'bass fish' })
      })

      it('should keep a phrase of exactly 100 characters after trimming and drop one of 101', () => {
        const result = normalizeSearches({
          ...fishCategory,
          searches: { BASS: ` ${'b'.repeat(100)} `, PIKE: 'p'.repeat(101) },
        })

        expect(result.searches).toEqual({ BASS: 'b'.repeat(100) })
      })

      it('should leave the rest of the category untouched', () => {
        const result = normalizeSearches({ ...fishCategory, embeddedSubstrings: [], searches: { BASS: 'bass fish' } })

        expect(result).toEqual({ ...fishCategory, embeddedSubstrings: [], searches: { BASS: 'bass fish' } })
      })
    })

    describe('gameTool', () => {
      it('should accept a generated payload with no searches at all', () => {
        expect(() => validateResponse(gameTool, generatedGame)).not.toThrow()
      })

      it('should accept a generated payload with searches', () => {
        const payload = {
          ...generatedGame,
          categories: {
            ...generatedGame.categories,
            Boast: { ...generatedGame.categories.Boast, searches: { CROW: 'crow boast' } },
          },
        }

        expect(() => validateResponse(gameTool, payload)).not.toThrow()
      })

      // Prompts deploy separately from code, so a model still on the old prompt must not fail ajv.
      it('should not require searches on a category', () => {
        expect(gameTool.input_schema.properties.categories.additionalProperties.required).not.toContain('searches')
      })
    })

    describe('checkGeneratedGame', () => {
      const history = buildCategoryHistory([])

      it('should key searches by the uppercased words', () => {
        const generated = {
          ...generatedGame,
          categories: {
            ...generatedGame.categories,
            Boast: {
              hint: 'Boast hint',
              searches: { crow: 'crow brag', 'show off': 'show off meaning' },
              words: ['bluster', 'crow', 'show off', 'strut'],
            },
          },
        }

        const { connectionsData: checked } = checkGeneratedGame(generated, history)

        expect(checked.categories.Boast.words).toEqual(['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT'])
        expect(checked.categories.Boast.searches).toEqual({ CROW: 'crow brag', 'SHOW OFF': 'show off meaning' })
      })

      it('should accept a generated payload with no searches at all', () => {
        const { connectionsData: checked } = checkGeneratedGame(generatedGame, history)

        expect(Object.values(checked.categories).filter((category) => 'searches' in category)).toEqual([])
      })
    })

    describe('findChargedTerm', () => {
      const chargedCategories = {
        ...connectionsData.categories,
        Boast: { ...connectionsData.categories.Boast, searches: { CROW: 'bastard crow' } },
      }

      it('should find a charged term that appears only in a search phrase', () => {
        expect(findChargedTerm(chargedCategories)).toEqual('BASTARD')
      })

      it('should make validateGame reject a charged search phrase', () => {
        expect(() => validateGame(chargedCategories)).toThrow('Generated a charged term: BASTARD')
      })
    })

    describe('finalizeVerifiedGame', () => {
      const history = buildCategoryHistory([])
      const verifiedGame = {
        categories: {
          ...connectionsData.categories,
          Boast: {
            hint: 'Boast hint',
            searches: { BRAG: 'brag boast', CROW: 'crow brag', 'SHOW OFF': 'show off meaning' },
            words: ['BLUSTER', 'CROW', 'brag', 'STRUT'],
          },
        },
      }

      it('should drop the phrase for a word the verifier removed', () => {
        const result = finalizeVerifiedGame(verifiedGame, history)

        expect(Object.keys(result.categories.Boast.searches ?? {})).not.toContain('SHOW OFF')
      })

      it('should uppercase a lowercase verifier word and keep its phrase', () => {
        const result = finalizeVerifiedGame(verifiedGame, history)

        expect(result.categories.Boast.words).toEqual(['BLUSTER', 'CROW', 'BRAG', 'STRUT'])
        expect(result.categories.Boast.searches).toEqual({ BRAG: 'brag boast', CROW: 'crow brag' })
        expect(result.wordList).toContain('BRAG')
      })
    })
  })
})
