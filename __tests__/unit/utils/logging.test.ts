import { extractRequestError, log, logDebug, logError } from '@utils/logging'

describe('logging', () => {
  beforeAll(() => {
    console.error = jest.fn()
    console.log = jest.fn()
  })

  describe('extractRequestError', () => {
    it('should return JSON data as an object', async () => {
      const data = { hello: 'world' }
      const output = extractRequestError(JSON.stringify(data))

      expect(output).toEqual({ errors: data })
    })

    it('should return non-JSON data as a string', async () => {
      const data = 'fnord'
      const output = extractRequestError(data)

      expect(output).toEqual({ message: data })
    })
  })

  describe('log', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke logFunc with message', async (value) => {
      const message = `Log message for value ${JSON.stringify(value)}`
      await log(message)

      expect(console.log).toHaveBeenCalledWith(message)
    })
  })

  describe('logDebug', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke logFunc with message', async (value) => {
      const message = `Debug message for value ${JSON.stringify(value)}`
      await logDebug(message)

      expect(console.log).toHaveBeenCalledWith(message)
    })
  })

  describe('logError', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke logFunc with message', async (value) => {
      const message = `Error message for value ${JSON.stringify(value)}`
      const error = new Error(message)
      await logError(error)

      expect(console.error).toHaveBeenCalledWith(error)
    })
  })
})
