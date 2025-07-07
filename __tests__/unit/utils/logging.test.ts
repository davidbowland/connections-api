import { DynamoDB } from '@aws-sdk/client-dynamodb'
import * as AWSXRay from 'aws-xray-sdk-core'
import https from 'https'

import { extractRequestError, log, logError, xrayCapture, xrayCaptureHttps } from '@utils/logging'

jest.mock('aws-xray-sdk-core')

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
      await log(message)

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

  describe('xrayCapture', () => {
    const capturedDynamodb = 'captured-dynamodb' as unknown as DynamoDB
    const dynamodb = 'dynamodb'

    beforeAll(() => {
      jest.mocked(AWSXRay).captureAWSv3Client.mockReturnValue(capturedDynamodb)
    })

    it('should invoke AWSXRay.captureAWSClient when x-ray is enabled (not running locally)', () => {
      process.env.AWS_SAM_LOCAL = 'false'
      const result = xrayCapture(dynamodb)

      expect(AWSXRay.captureAWSv3Client).toHaveBeenCalledWith(dynamodb)
      expect(result).toEqual(capturedDynamodb)
    })

    it('should return the same object when x-ray is disabled (running locally)', () => {
      process.env.AWS_SAM_LOCAL = 'true'
      const result = xrayCapture(dynamodb)

      expect(AWSXRay.captureAWSv3Client).toHaveBeenCalledTimes(0)
      expect(result).toEqual(dynamodb)
    })
  })

  describe('xrayCaptureHttps', () => {
    it('should invoke AWSXRay.captureHTTPsGlobal when x-ray is enabled (not running locally)', () => {
      process.env.AWS_SAM_LOCAL = 'false'
      xrayCaptureHttps()

      expect(AWSXRay.captureHTTPsGlobal).toHaveBeenCalledWith(https)
    })

    it('should return the same object when x-ray is disabled (running locally)', () => {
      process.env.AWS_SAM_LOCAL = 'true'
      xrayCaptureHttps()

      expect(AWSXRay.captureHTTPsGlobal).toHaveBeenCalledTimes(0)
    })
  })
})
