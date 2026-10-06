import { connectionsData, promptConfig } from '../__mocks__'
import { alwaysDisallowedCategories } from '@assets/constraints'
import * as dynamodb from '@services/dynamodb'
import { checkLocalGame, finalizeLocalGame, prepareLocalGame } from '@services/local-generation'
import { Prompt } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('local-generation', () => {
  const gameId = '2025-03-04'
  const createPrompt: Prompt = { config: promptConfig, contents: 'Create a game. <context>${context}</context>' }
  const verifyPrompt: Prompt = { config: promptConfig, contents: 'Verify a game. <context>${context}</context>' }
  const random = () => 0

  // The shape a generator subagent writes: the submit_game tool input, decoys included. Words are
  // lowercased to prove the shared checks still normalize them.
  const generatedPayload = {
    categories: {
      Boast: { hint: 'Boast hint', words: ['bluster', 'crow', 'show off', 'strut'] },
      'Arc-shaped things': {
        hint: 'Arc-shaped things hint',
        words: ['banana', 'eyebrow', 'flight path', 'rainbow'],
      },
      'Cereal mascots': {
        hint: 'Cereal mascots hint',
        words: ['count', 'elves', 'leprechaun', 'rooster'],
      },
      'Ways to denote a citation': {
        hint: 'Ways to denote a citation hint',
        words: ['asterisk', 'dagger', 'number', 'parens'],
      },
    },
    decoys: [
      { looksLike: 'Cereal mascots', word: 'CROW' },
      { looksLike: 'Ways to denote a citation', word: 'COUNT' },
      { looksLike: 'Boast', word: 'DAGGER' },
    ],
  }

  const modelContext = { disallowedCategories: ['Things that are green'] }
  const passVerdict = { reason: 'Looks good', verdict: 'pass' }

  beforeAll(() => {
    jest.mocked(dynamodb).getGameById.mockResolvedValue({ isGenerating: false })
    jest.mocked(dynamodb).getAllGames.mockResolvedValue({ '2025-03-01': connectionsData })
    jest.mocked(dynamodb).setGameByIdIfAbsent.mockResolvedValue(true)
  })

  describe('prepareLocalGame', () => {
    it('should refuse a date that already has a game', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ game: connectionsData, isGenerating: false })

      await expect(prepareLocalGame(gameId, createPrompt, random)).rejects.toThrow(`Game already exists: ${gameId}`)
      expect(dynamodb.getAllGames).not.toHaveBeenCalled()
    })

    it('should not treat an in-progress Lambda generation as an existing game', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ isGenerating: true })

      await expect(prepareLocalGame(gameId, createPrompt, random)).resolves.toBeDefined()
    })

    it('should disallow the always-disallowed list plus the categories of stored games', async () => {
      const { modelContext: prepared } = await prepareLocalGame(gameId, createPrompt, random)

      expect(prepared.disallowedCategories).toEqual([
        ...alwaysDisallowedCategories,
        ...Object.keys(connectionsData.categories),
      ])
    })

    it('should render the create prompt with the model context, XML-escaped', async () => {
      const { modelContext: prepared, promptContents } = await prepareLocalGame(gameId, createPrompt, random)

      const rendered = JSON.stringify(prepared).replace(/</g, '&lt;').replace(/>/g, '&gt;')
      expect(promptContents).toEqual(`Create a game. <context>${rendered}</context>`)
    })
  })

  describe('checkLocalGame', () => {
    it('should render the verify prompt with the normalized game and the decoys', () => {
      const { promptContents } = checkLocalGame(modelContext, generatedPayload, verifyPrompt)

      const context = JSON.parse(promptContents.replace(/^Verify a game\. <context>|<\/context>$/g, ''))
      expect(context).toEqual({ decoys: generatedPayload.decoys, game: { categories: connectionsData.categories } })
    })

    it('should reject a payload that does not match the submit_game schema', () => {
      expect(() => checkLocalGame(modelContext, { categories: {} }, verifyPrompt)).toThrow(
        'Model response failed schema validation for tool "submit_game"',
      )
    })

    it('should reject a category the model context disallowed', () => {
      expect(() => checkLocalGame({ disallowedCategories: ['Boast'] }, generatedPayload, verifyPrompt)).toThrow(
        'Generated a repeated category: Boast',
      )
    })

    it('should reject decoys that fail the structural decoy checks', () => {
      const payload = { ...generatedPayload, decoys: generatedPayload.decoys.slice(0, 2) }

      expect(() => checkLocalGame(modelContext, payload, verifyPrompt)).toThrow()
    })
  })

  describe('finalizeLocalGame', () => {
    it('should upload a passed game with its word list and a local usage marker', async () => {
      const result = await finalizeLocalGame(gameId, modelContext, generatedPayload, passVerdict)

      expect(result).toEqual(connectionsData)
      expect(dynamodb.setGameByIdIfAbsent).toHaveBeenCalledWith(gameId, connectionsData, { source: 'local' })
    })

    it('should apply the verifier fixes before uploading', async () => {
      const verdict = { fixes: { Boast: { hint: 'Better hint' } }, reason: 'Hint was weak', verdict: 'fix' }

      const result = await finalizeLocalGame(gameId, modelContext, generatedPayload, verdict)

      expect(result.categories.Boast.hint).toEqual('Better hint')
    })

    it('should re-run the generation checks rather than trust the earlier step', async () => {
      await expect(
        finalizeLocalGame(gameId, { disallowedCategories: ['Boast'] }, generatedPayload, passVerdict),
      ).rejects.toThrow('Generated a repeated category: Boast')
      expect(dynamodb.setGameByIdIfAbsent).not.toHaveBeenCalled()
    })

    it('should not upload a failed game', async () => {
      await expect(
        finalizeLocalGame(gameId, modelContext, generatedPayload, { reason: 'Ambiguous', verdict: 'fail' }),
      ).rejects.toThrow('Verification failed: Ambiguous')
      expect(dynamodb.setGameByIdIfAbsent).not.toHaveBeenCalled()
    })

    it('should reject a verdict that does not match the submit_verdict schema', async () => {
      await expect(finalizeLocalGame(gameId, modelContext, generatedPayload, { verdict: 'pass' })).rejects.toThrow(
        'Model response failed schema validation for tool "submit_verdict"',
      )
    })

    it('should reject a fix that replaces a category with a repeat', async () => {
      const verdict = {
        fixes: {
          Boast: { category: { hint: 'h', name: 'Things that are green', words: ['A', 'B', 'C', 'D'] } },
        },
        reason: 'Replace',
        verdict: 'fix',
      }

      await expect(finalizeLocalGame(gameId, modelContext, generatedPayload, verdict)).rejects.toThrow(
        'Generated a repeated category: Things that are green',
      )
    })

    it('should fail rather than overwrite when a game was stored in the meantime', async () => {
      jest.mocked(dynamodb).setGameByIdIfAbsent.mockResolvedValueOnce(false)

      await expect(finalizeLocalGame(gameId, modelContext, generatedPayload, passVerdict)).rejects.toThrow(
        `Game already exists: ${gameId}`,
      )
    })
  })
})
