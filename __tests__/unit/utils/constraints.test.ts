import { getDateConstraint } from '@utils/constraints'

describe('constraints', () => {
  describe('getDateConstraint', () => {
    it("should return fixed date constraint for New Year's Day", () => {
      const newYearsDate = new Date(2026, 0, 1) // January 1, 2026
      const result = getDateConstraint(newYearsDate)

      expect(result).toEqual(expect.stringContaining('New Year'))
    })

    it("should return fixed date constraint for Valentine's Day", () => {
      const valentinesDate = new Date(2026, 1, 14) // February 14, 2026
      const result = getDateConstraint(valentinesDate)

      expect(result).toEqual(expect.stringContaining('Valentine'))
    })

    it("should return fixed date constraint for April Fools' Day", () => {
      const aprilFoolsDate = new Date(2026, 3, 1) // April 1, 2026
      const result = getDateConstraint(aprilFoolsDate)

      expect(result).toEqual(expect.stringContaining('April Fools'))
    })

    it('should return fixed date constraint for Independence Day', () => {
      const july4thDate = new Date(2026, 6, 4) // July 4, 2026
      const result = getDateConstraint(july4thDate)

      expect(result).toEqual(expect.stringContaining('Independence Day'))
    })

    it('should return fixed date constraint for Halloween', () => {
      const halloweenDate = new Date(2026, 9, 31) // October 31, 2026
      const result = getDateConstraint(halloweenDate)

      expect(result).toEqual(expect.stringContaining('Halloween'))
    })

    it('should return fixed date constraint for Veterans Day', () => {
      const veteransDate = new Date(2026, 10, 11) // November 11, 2026
      const result = getDateConstraint(veteransDate)

      expect(result).toEqual(expect.stringContaining('Veterans Day'))
    })

    it('should return fixed date constraint for Christmas', () => {
      const christmasDate = new Date(2026, 11, 25) // December 25, 2026
      const result = getDateConstraint(christmasDate)

      expect(result).toEqual(expect.stringContaining('Christmas'))
    })

    it('should return floating holiday constraint for MLK Day (3rd Monday of January)', () => {
      const mlkDay = new Date(2026, 0, 19) // January 19, 2026 (3rd Monday)
      const result = getDateConstraint(mlkDay)

      expect(result).toEqual(expect.stringContaining('Martin Luther King'))
    })

    it("should return floating holiday constraint for Mother's Day (2nd Sunday of May)", () => {
      const mothersDay = new Date(2026, 4, 10) // May 10, 2026 (2nd Sunday)
      const result = getDateConstraint(mothersDay)

      expect(result).toEqual(expect.stringContaining("Mother's Day"))
    })

    it('should return floating holiday constraint for Memorial Day (last Monday of May)', () => {
      const memorialDay = new Date(2026, 4, 25) // May 25, 2026 (last Monday)
      const result = getDateConstraint(memorialDay)

      expect(result).toEqual(expect.stringContaining('Memorial Day'))
    })

    it("should return floating holiday constraint for Father's Day (3rd Sunday of June)", () => {
      const fathersDay = new Date(2026, 5, 21) // June 21, 2026 (3rd Sunday)
      const result = getDateConstraint(fathersDay)

      expect(result).toEqual(expect.stringContaining("Father's Day"))
    })

    it('should return floating holiday constraint for Labor Day (1st Monday of September)', () => {
      const laborDay = new Date(2026, 8, 7) // September 7, 2026 (1st Monday)
      const result = getDateConstraint(laborDay)

      expect(result).toEqual(expect.stringContaining('Labor Day'))
    })

    it('should return floating holiday constraint for Thanksgiving (4th Thursday of November)', () => {
      const thanksgiving = new Date(2026, 10, 26) // November 26, 2026 (4th Thursday)
      const result = getDateConstraint(thanksgiving)

      expect(result).toEqual(expect.stringContaining('Thanksgiving'))
    })

    it('should return floating holiday constraint for Black Friday (Friday after Thanksgiving)', () => {
      const blackFriday = new Date(2026, 10, 27) // November 27, 2026 (Friday after Thanksgiving)
      const result = getDateConstraint(blackFriday)

      expect(result).toEqual(expect.stringContaining('Black Friday'))
    })

    it('should return floating holiday constraint for Cyber Monday (Monday after Thanksgiving)', () => {
      const cyberMonday = new Date(2026, 10, 30) // November 30, 2026 (Monday after Thanksgiving)
      const result = getDateConstraint(cyberMonday)

      expect(result).toEqual(expect.stringContaining('Cyber Monday'))
    })

    it('should return floating holiday constraint for Cyber Monday (Monday after Thanksgiving) in December', () => {
      const cyberMonday = new Date(2030, 11, 2) // December 2, 2030 (Monday after Thanksgiving)
      const result = getDateConstraint(cyberMonday)

      expect(result).toEqual(expect.stringContaining('Cyber Monday'))
    })

    it('should return undefined for dates that are not the correct week of floating holidays', () => {
      const notMLKDay = new Date(2026, 0, 12) // 2nd Monday, not 3rd
      const result = getDateConstraint(notMLKDay)

      expect(result).toBeUndefined()
    })

    it('should return undefined for non-holiday dates', () => {
      const regularDate = new Date(2026, 5, 10)
      const result = getDateConstraint(regularDate)

      expect(result).toBeUndefined()
    })
  })
})
