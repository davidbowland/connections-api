import { isValidGameId } from '@utils/game-id'

describe('game-id', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-06-15'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('isValidGameId', () => {
    it('returns true for a valid past date', () => {
      expect(isValidGameId('2025-06-14')).toBe(true)
    })

    it('returns true for today', () => {
      expect(isValidGameId('2025-06-15')).toBe(true)
    })

    it('returns false for a future date', () => {
      expect(isValidGameId('2025-06-16')).toBe(false)
    })

    it('returns false for a date before 2025-01-01', () => {
      expect(isValidGameId('2024-12-31')).toBe(false)
    })

    it('returns false for a non-date string', () => {
      expect(isValidGameId('invalid')).toBe(false)
    })

    it('returns false for an impossible date', () => {
      expect(isValidGameId('2025-13-01')).toBe(false)
    })
  })
})
