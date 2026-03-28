import { game, prompt } from '../__mocks__'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import { verifyAndFixGame } from '@services/verification'
import { VerificationResult } from '@types'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('verification', () => {
  beforeAll(() => {
    jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
  })

  describe('verifyAndFixGame', () => {
    it('should return game unchanged on pass verdict', async () => {
      const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned).toBe(game)
    })

    it('should apply valid word replacements on fix verdict', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Two words too obvious',
        fixes: {
          Boast: {
            words: ['BLUSTER', 'CROW', 'BRAG', 'SWAGGER'],
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned.categories['Boast'].words).toEqual(['BLUSTER', 'CROW', 'BRAG', 'SWAGGER'])
      expect(returned.categories['Arc-shaped things']).toEqual(game.categories['Arc-shaped things'])
    })

    it('should throw when fix exceeds per-category word change limit (> 2)', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Too many obvious words',
        fixes: {
          Boast: {
            words: ['BLUSTER', 'PREEN', 'BRAG', 'SWAGGER'],
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow(
        'Fix exceeds per-category word change limit (> 2) for category: Boast',
      )
    })

    it('should throw when fix exceeds total word change limit (> 4)', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Multiple categories need fixes',
        fixes: {
          Boast: {
            words: ['BLUSTER', 'PREEN', 'BRAG', 'STRUT'],
          },
          'Arc-shaped things': {
            words: ['ARCH', 'CURVE', 'FLIGHT PATH', 'RAINBOW'],
          },
          'Cereal mascots': {
            words: ['COUNT', 'ELVES', 'TOUCAN', 'ROOSTER'],
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow(
        'Fix exceeds total word change limit (> 4)',
      )
    })

    it('should throw when fix replaces more than 1 category', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Two categories need full replacement',
        fixes: {
          Boast: {
            category: {
              name: 'Show pride',
              words: ['PREEN', 'BRAG', 'SWAGGER', 'GLOAT'],
              hint: 'Could you be getting a big head?',
              embeddedSubstrings: [],
            },
          },
          'Arc-shaped things': {
            category: {
              name: 'Curved objects',
              words: ['ARCH', 'BRIDGE', 'CRESCENT', 'HOOK'],
              hint: 'Do these share a shape?',
              embeddedSubstrings: [],
            },
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow(
        'Fix exceeds category replacement limit (> 1)',
      )
    })

    it('should throw on fail verdict', async () => {
      const result: VerificationResult = {
        verdict: 'fail',
        reason: 'Category concept is fundamentally broken',
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow(
        'Haiku verification failed: Category concept is fundamentally broken',
      )
    })

    it('should throw on unrecognised verdict string', async () => {
      const result = { verdict: 'retry', reason: 'Try again' } as unknown as VerificationResult
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow('Unrecognised verdict: retry')
    })

    it('should throw on malformed Haiku response (JSON parse failure)', async () => {
      jest
        .mocked(bedrock)
        .invokeModel.mockRejectedValueOnce(new SyntaxError('Unexpected token in JSON'))

      await expect(verifyAndFixGame(game, {})).rejects.toThrow('Unexpected token in JSON')
    })

    it('should apply a full category replacement on fix verdict with category field', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Category concept needs full replacement',
        fixes: {
          Boast: {
            category: {
              name: 'Show off',
              words: ['PREEN', 'FLAUNT', 'PARADE', 'PEACOCK'],
              hint: 'Could you be getting a big head?',
              embeddedSubstrings: [],
            },
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned.categories['Boast']).toBeUndefined()
      expect(returned.categories['Show off']).toEqual({
        embeddedSubstrings: [],
        hint: 'Could you be getting a big head?',
        words: ['PREEN', 'FLAUNT', 'PARADE', 'PEACOCK'],
      })
    })

    it('should return game unchanged on fix verdict with no fixes provided', async () => {
      const result: VerificationResult = { verdict: 'fix', reason: 'Minor issue', fixes: undefined }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned).toBe(game)
    })

    it('should throw when fix references an unknown category name', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Fix needed',
        fixes: {
          'Unknown Category': {
            words: ['WORD1', 'WORD2', 'WORD3', 'WORD4'],
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow(
        'Fix references unknown category: Unknown Category',
      )
    })

    it('should pass game and modelContext as context to invokeModel', async () => {
      const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)
      const modelContext = { wordConstraints: 'all words must be 4 letters' }

      await verifyAndFixGame(game, modelContext)

      expect(bedrock.invokeModel).toHaveBeenCalledWith(prompt, { game, modelContext })
    })

    it('should apply a hint-only fix without changing words', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Hint leaks category words',
        fixes: {
          Boast: {
            hint: 'Are you feeling proud?',
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned.categories['Boast'].hint).toBe('Are you feeling proud?')
      expect(returned.categories['Boast'].words).toEqual(game.categories['Boast'].words)
    })

    it('should apply both word and hint fixes for the same category', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Words too obvious and hint leaks words',
        fixes: {
          Boast: {
            words: ['BLUSTER', 'CROW', 'BRAG', 'SWAGGER'],
            hint: 'Are you feeling proud?',
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned.categories['Boast'].words).toEqual(['BLUSTER', 'CROW', 'BRAG', 'SWAGGER'])
      expect(returned.categories['Boast'].hint).toBe('Are you feeling proud?')
    })

    it('should apply hint fixes across multiple categories', async () => {
      const result: VerificationResult = {
        verdict: 'fix',
        reason: 'Multiple hints leak words',
        fixes: {
          Boast: {
            hint: 'Are you feeling proud?',
          },
          'Arc-shaped things': {
            hint: 'Do you see a curvy theme?',
          },
        },
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      const returned = await verifyAndFixGame(game, {})

      expect(returned.categories['Boast'].hint).toBe('Are you feeling proud?')
      expect(returned.categories['Boast'].words).toEqual(game.categories['Boast'].words)
      expect(returned.categories['Arc-shaped things'].hint).toBe('Do you see a curvy theme?')
      expect(returned.categories['Arc-shaped things'].words).toEqual(
        game.categories['Arc-shaped things'].words,
      )
    })
  })
})
