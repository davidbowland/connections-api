import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

import { Prompt } from '../types'
import { logDebug } from '../utils/logging'

const runtimeClient = new BedrockRuntimeClient({ region: 'us-east-1' })

export const invokeModel = async <T>(prompt: Prompt, context?: Record<string, any>): Promise<T> => {
  const promptWithContext = context
    ? { ...prompt, contents: prompt.contents.replace('${context}', JSON.stringify(context)) }
    : prompt
  return invokeModelMessage(promptWithContext)
}

export const invokeModelMessage = async <T>(prompt: Prompt): Promise<T> => {
  logDebug('Invoking model', { prompt })
  const messageBody = {
    anthropic_version: prompt.config.anthropicVersion,
    max_tokens: prompt.config.maxTokens,
    messages: [{ content: prompt.contents, role: 'user' }],
    temperature: prompt.config.temperature,
    top_k: prompt.config.topK,
  }
  logDebug('Received from model', {
    messageBody,
    messages: JSON.stringify(messageBody.messages, null, 2),
  })
  const command = new InvokeModelCommand({
    body: new TextEncoder().encode(JSON.stringify(messageBody)), // new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
    contentType: 'application/json',
    modelId: prompt.config.model,
  })
  const response = await runtimeClient.send(command)
  const modelResponse = JSON.parse(new TextDecoder().decode(response.body))
  logDebug('Model response', { modelResponse, text: modelResponse.content[0].text })
  return JSON.parse(
    modelResponse.content[0].text.replace(
      /(^\s*<thinking>.*?<\/thinking>\s*|^\s*|\s*`(json)?\s*|\s*$)/gs,
      '',
    ),
  )
}
