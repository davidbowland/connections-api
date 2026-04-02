import {
  connectionsData,
  invokeModelCategories,
  invokeModelResponse,
  invokeModelResponseData,
  prompt,
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
    beforeAll(() => {
      mockSend.mockResolvedValue(invokeModelResponse)
    })

    it('should invoke the correct model based on the prompt', async () => {
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
  })

  describe('parseResponse (via invokeModelMessage)', () => {
    const buildMockResponse = (text: string) => ({
      ...invokeModelResponse,
      body: new TextEncoder().encode(
        JSON.stringify({
          ...invokeModelResponseData,
          content: [{ type: 'text', text }],
        }),
      ),
    })

    const expectedCategories = { ...connectionsData, wordList: undefined }
    const json = JSON.stringify(invokeModelCategories, null, 2)

    it('should strip preamble text before JSON', async () => {
      mockSend.mockResolvedValue(
        buildMockResponse(
          `Looking at the April Fools' Day constraint, I need to create categories...\n${json}`,
        ),
      )
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should strip preamble text and trailing text around JSON', async () => {
      mockSend.mockResolvedValue(buildMockResponse(`Here is the game:\n${json}\nHope that works!`))
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should handle thinking tags followed by preamble text', async () => {
      mockSend.mockResolvedValue(
        buildMockResponse(
          `<thinking>Let me think...</thinking>\nLooking at the constraints...\n${json}`,
        ),
      )
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should handle clean JSON with no preamble', async () => {
      mockSend.mockResolvedValue(buildMockResponse(json))
      const result = await invokeModelMessage(prompt)
      expect(result).toEqual(expectedCategories)
    })

    it('should throw on response with no JSON object', async () => {
      mockSend.mockResolvedValue(buildMockResponse('this is not json at all'))
      await expect(invokeModelMessage(prompt)).rejects.toThrow()
    })
  })
})
