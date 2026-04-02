import {
  connectionsData,
  invokeModelCategories,
  invokeModelResponse,
  invokeModelResponseData,
  invokeModelThinkingResponse,
  prompt,
  thinkingPrompt,
} from '../__mocks__'
import { invokeModel, invokeModelMessage } from '@services/bedrock'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({
    send: (...args) => mockSend(...args),
  })),
  InvokeModelCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('bedrock', () => {
  const data = 'super-happy-fun-data'

  describe('invokeModel', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue(invokeModelResponse)
    })

    it('should invoke the correct model based on the prompt', async () => {
      const result = await invokeModel(prompt)

      expect(result).toEqual(invokeModelCategories)
      expect(mockSend).toHaveBeenCalledWith({
        body: new TextEncoder().encode(
          JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 256,
            messages: [{ content: prompt.contents, role: 'user' }],
            temperature: 0.5,
            top_k: 250,
          }),
        ),
        contentType: 'application/json',
        modelId: 'the-best-ai:1.0',
      })
    })

    it('should inject context into the prompt when passed', async () => {
      const promptWithContext = {
        ...prompt,
        contents: 'My context should go here: ${context}',
      }
      const result = await invokeModel(promptWithContext, { data })

      expect(result).toEqual({ ...connectionsData, wordList: undefined })
      expect(mockSend).toHaveBeenCalledWith({
        body: new TextEncoder().encode(
          JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 256,
            messages: [
              {
                content: 'My context should go here: {"data":"super-happy-fun-data"}',
                role: 'user',
              },
            ],
            temperature: 0.5,
            top_k: 250,
          }),
        ),
        contentType: 'application/json',
        modelId: 'the-best-ai:1.0',
      })
    })
  })

  describe('invokeModelMessage', () => {
    it('should send temperature/topK for non-thinking prompts', async () => {
      mockSend.mockResolvedValue(invokeModelResponse)
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual({ ...connectionsData, wordList: undefined })
      expect(mockSend).toHaveBeenCalledWith({
        body: new TextEncoder().encode(
          JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 256,
            messages: [{ content: prompt.contents, role: 'user' }],
            temperature: 0.5,
            top_k: 250,
          }),
        ),
        contentType: 'application/json',
        modelId: 'the-best-ai:1.0',
      })
    })

    it('should send thinking config for thinking-enabled prompts', async () => {
      mockSend.mockResolvedValue(invokeModelThinkingResponse)
      const result = await invokeModelMessage(thinkingPrompt)
      expect(result).toEqual({ ...connectionsData, wordList: undefined })
      expect(mockSend).toHaveBeenCalledWith({
        body: new TextEncoder().encode(
          JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 32000,
            messages: [{ content: thinkingPrompt.contents, role: 'user' }],
            thinking: { type: 'enabled', budget_tokens: 25000 },
          }),
        ),
        contentType: 'application/json',
        modelId: 'the-thinking-ai:1.0',
      })
    })

    it('should extract text block from thinking response with multiple content blocks', async () => {
      mockSend.mockResolvedValue(invokeModelThinkingResponse)
      const result = await invokeModelMessage(thinkingPrompt)
      expect(result).toEqual({ ...connectionsData, wordList: undefined })
    })
  })

  describe('parseResponse (via invokeModelMessage)', () => {
    const buildMockResponse = (
      contentBlocks: Array<{ type: string; text?: string; thinking?: string }>,
    ) => ({
      ...invokeModelResponse,
      body: new TextEncoder().encode(
        JSON.stringify({
          ...invokeModelResponseData,
          content: contentBlocks,
        }),
      ),
    })

    const buildTextOnlyResponse = (text: string) => buildMockResponse([{ type: 'text', text }])

    const expectedCategories = { ...connectionsData, wordList: undefined }
    const json = JSON.stringify(invokeModelCategories, null, 2)

    it('should strip preamble text before JSON', async () => {
      mockSend.mockResolvedValue(
        buildTextOnlyResponse(
          `Looking at the April Fools' Day constraint, I need to create categories...\n${json}`,
        ),
      )
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should strip preamble text and trailing text around JSON', async () => {
      mockSend.mockResolvedValue(
        buildTextOnlyResponse(`Here is the game:\n${json}\nHope that works!`),
      )
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should handle thinking tags followed by preamble text', async () => {
      mockSend.mockResolvedValue(
        buildTextOnlyResponse(
          `<thinking>Let me think...</thinking>\nLooking at the constraints...\n${json}`,
        ),
      )
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should handle clean JSON with no preamble', async () => {
      mockSend.mockResolvedValue(buildTextOnlyResponse(json))
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should parse text block from structured thinking response', async () => {
      mockSend.mockResolvedValue(
        buildMockResponse([
          { type: 'thinking', thinking: 'Deep thoughts about categories...' },
          { type: 'text', text: json },
        ]),
      )
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should throw on response with no JSON object', async () => {
      mockSend.mockResolvedValue(buildTextOnlyResponse('this is not json at all'))
      await expect(invokeModelMessage(prompt)).rejects.toThrow()
    })

    it('should throw when response has no text block', async () => {
      mockSend.mockResolvedValue(
        buildMockResponse([{ type: 'thinking', thinking: 'Only thinking, no text' }]),
      )
      await expect(invokeModelMessage(prompt)).rejects.toThrow()
    })
  })
})
