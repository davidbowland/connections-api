import { debugLogging } from '../config'

export const extractRequestError = (message: string): { errors?: unknown; message?: string } => {
  try {
    return { errors: JSON.parse(message) }
  } catch {
    return { message }
  }
}

export const log = (...args: unknown[]): unknown => console.log(...args)

export const logDebug = (...args: unknown[]): unknown => (debugLogging ? console.log(...args) : undefined)

export const logError = (...args: unknown[]): unknown => console.error(...args)
