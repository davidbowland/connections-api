import { game, prompt } from '../__mocks__'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import { applyVerdict, verdictTool, verifyAndFixGame } from '@services/verification'
import { Decoy, VerificationResult } from '@types'

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

      await expect(verifyAndFixGame(game, {})).rejects.toThrow('Fix exceeds total word change limit (> 4)')
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

      await expect(verifyAndFixGame(game, {})).rejects.toThrow('Fix exceeds category replacement limit (> 1)')
    })

    it('should throw on fail verdict', async () => {
      const result: VerificationResult = {
        verdict: 'fail',
        reason: 'Category concept is fundamentally broken',
      }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow(
        'Verification failed: Category concept is fundamentally broken',
      )
    })

    it('should throw on unrecognized verdict string', async () => {
      const result = { verdict: 'retry', reason: 'Try again' } as unknown as VerificationResult
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

      await expect(verifyAndFixGame(game, {})).rejects.toThrow('Unrecognized verdict: retry')
    })

    it('should throw on malformed verifier response (JSON parse failure)', async () => {
      jest.mocked(bedrock).invokeModel.mockRejectedValueOnce(new SyntaxError('Unexpected token in JSON'))

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

      await expect(verifyAndFixGame(game, {})).rejects.toThrow('Fix references unknown category: Unknown Category')
    })

    it('should pass only game and relevant constraints to invokeModel', async () => {
      const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
      jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)
      const modelContext = {
        categoryConstraints: ['Things with a shared property'],
        wordConstraints: 'all words must be 4 letters',
        disallowedCategories: ['Weather'],
        inspirationNouns: ['dog'],
      }

      await verifyAndFixGame(game, modelContext)

      expect(bedrock.invokeModel).toHaveBeenCalledWith(
        prompt,
        verdictTool,
        {
          categoryConstraints: ['Things with a shared property'],
          game,
          wordConstraints: 'all words must be 4 letters',
        },
        undefined,
      )
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
      expect(returned.categories['Arc-shaped things'].words).toEqual(game.categories['Arc-shaped things'].words)
    })

    // Decoys are read-only audit material for the verifier. They arrive as their own argument and
    // must never be folded into the game object -- see the destructure in createGame.
    describe('decoys', () => {
      const decoys: Decoy[] = [
        { looksLike: 'Arc-shaped things', word: 'CROW' },
        { looksLike: 'Boast', word: 'ROOSTER' },
        { looksLike: 'Cereal mascots', word: 'BANANA' },
      ]

      const getVerifierContext = (): Record<string, any> => jest.mocked(bedrock).invokeModel.mock.calls[0][2]

      it('should pass decoys to the verifier as context', async () => {
        const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
        jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

        await verifyAndFixGame(game, {}, decoys)

        expect(bedrock.invokeModel).toHaveBeenCalledWith(
          prompt,
          verdictTool,
          expect.objectContaining({ decoys }),
          undefined,
        )
      })

      // Object.keys rather than expect.not.objectContaining, which passes when the key is present
      // with an undefined value -- the verifier prompt branches on the key existing at all.
      it('should omit the decoys key entirely when none are supplied', async () => {
        const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
        jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

        await verifyAndFixGame(game, {})

        expect(Object.keys(getVerifierContext())).not.toContain('decoys')
      })

      it('should omit the decoys key entirely when an empty array is supplied', async () => {
        const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
        jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

        await verifyAndFixGame(game, {}, [])

        expect(Object.keys(getVerifierContext())).not.toContain('decoys')
      })

      it('should not merge decoys into the game object handed to the verifier', async () => {
        const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
        jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

        await verifyAndFixGame(game, {}, decoys)

        expect(Object.keys(getVerifierContext().game)).not.toContain('decoys')
        expect(getVerifierContext().game).toEqual(game)
      })

      it('should return the game unchanged when decoys are supplied', async () => {
        const result: VerificationResult = { verdict: 'pass', reason: 'All good' }
        jest.mocked(bedrock).invokeModel.mockResolvedValueOnce(result)

        const returned = await verifyAndFixGame(game, {}, decoys)

        expect(returned).toBe(game)
      })
    })
  })

  // The verifier can change words, so it can also supply phrases for the words it introduces.
  // applyFixes only merges; pruning phrases for removed words is finalizeVerifiedGame's job.
  describe('searches', () => {
    // bedrock is mocked for the rest of this file; schema validation needs the real ajv path.
    const { validateResponse } = jest.requireActual<typeof bedrock>('@services/bedrock')

    const boastSearches = { BLUSTER: 'bluster meaning', CROW: 'crow brag' }
    const searchGame = {
      categories: {
        ...game.categories,
        Boast: { ...game.categories.Boast, searches: boastSearches },
      },
    }

    describe('verdictTool', () => {
      it('should accept a word fix carrying searches', () => {
        const verdict = {
          fixes: { Boast: { searches: { BRAG: 'brag' }, words: ['BLUSTER', 'CROW', 'BRAG', 'STRUT'] } },
          reason: 'Obvious words',
          verdict: 'fix',
        }

        expect(() => validateResponse(verdictTool, verdict)).not.toThrow()
      })

      it('should accept a category replacement carrying searches', () => {
        const verdict = {
          fixes: {
            Boast: {
              category: {
                hint: 'Could you be getting a big head?',
                name: 'Show off',
                searches: { PEACOCK: 'peacock show off' },
                words: ['PREEN', 'FLAUNT', 'PARADE', 'PEACOCK'],
              },
            },
          },
          reason: 'Weak concept',
          verdict: 'fix',
        }

        expect(() => validateResponse(verdictTool, verdict)).not.toThrow()
      })
    })

    describe('applyVerdict', () => {
      it('should carry the replacement category searches', () => {
        const result: VerificationResult = {
          verdict: 'fix',
          reason: 'Weak concept',
          fixes: {
            Boast: {
              category: {
                name: 'Show off',
                words: ['PREEN', 'FLAUNT', 'PARADE', 'PEACOCK'],
                hint: 'Could you be getting a big head?',
                searches: { PEACOCK: 'peacock show off' },
              },
            },
          },
        }

        const returned = applyVerdict(searchGame, result)

        expect(returned.categories['Show off'].searches).toEqual({ PEACOCK: 'peacock show off' })
      })

      it('should merge word-fix searches over the existing map', () => {
        const result: VerificationResult = {
          verdict: 'fix',
          reason: 'Obvious words',
          fixes: {
            Boast: {
              words: ['BLUSTER', 'CROW', 'BRAG', 'STRUT'],
              searches: { BRAG: 'brag', CROW: 'crow boast' },
            },
          },
        }

        const returned = applyVerdict(searchGame, result)

        expect(returned.categories.Boast.searches).toEqual({
          BLUSTER: 'bluster meaning',
          BRAG: 'brag',
          CROW: 'crow boast',
        })
      })

      it('should merge a fix that carries only searches', () => {
        const result: VerificationResult = {
          verdict: 'fix',
          reason: 'Ambiguous search',
          fixes: { Boast: { searches: { STRUT: 'strut walk' } } },
        }

        const returned = applyVerdict(searchGame, result)

        expect(returned.categories.Boast.searches).toEqual({ ...boastSearches, STRUT: 'strut walk' })
        expect(returned.categories.Boast.words).toEqual(game.categories.Boast.words)
      })

      it('should leave searches unchanged on a hint fix without searches', () => {
        const result: VerificationResult = {
          verdict: 'fix',
          reason: 'Hint leaks words',
          fixes: { Boast: { hint: 'Are you feeling proud?' } },
        }

        const returned = applyVerdict(searchGame, result)

        expect(returned.categories.Boast.searches).toEqual(boastSearches)
      })
    })
  })
})
