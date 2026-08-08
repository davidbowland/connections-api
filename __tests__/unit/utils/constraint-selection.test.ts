import { tier1CategoryConstraints, tier2CategoryConstraints, tier3CategoryConstraints } from '@assets/constraints'
import { drawConstraints } from '@utils/constraint-selection'

describe('constraint-selection', () => {
  describe('drawConstraints', () => {
    it('should draw the requested number of constraints', () => {
      const random = jest.fn().mockReturnValue(0)

      expect(drawConstraints(4, random)).toHaveLength(4)
    })

    it('should draw from tier 1 for a low tier roll', () => {
      const random = jest.fn().mockReturnValue(0)

      expect(drawConstraints(1, random)).toEqual([{ constraint: tier1CategoryConstraints[0], tier: 1 }])
    })

    it('should draw from tier 2 for a mid tier roll', () => {
      // 0.8 of the 1.0 total lands past tier 1 (0.70) and inside tier 2 (0.24).
      const random = jest.fn().mockReturnValueOnce(0.8).mockReturnValue(0)

      expect(drawConstraints(1, random)).toEqual([{ constraint: tier2CategoryConstraints[0], tier: 2 }])
    })

    it('should draw from tier 3 for a high tier roll', () => {
      const random = jest.fn().mockReturnValueOnce(0.99).mockReturnValue(0)

      expect(drawConstraints(1, random)).toEqual([{ constraint: tier3CategoryConstraints[0], tier: 3 }])
    })

    it('should never draw more than one tier 3 constraint', () => {
      const random = jest.fn().mockReturnValue(0.99)

      const drawn = drawConstraints(4, random)

      expect(drawn.filter(({ tier }) => tier === 3)).toHaveLength(1)
    })

    it('should fall back to tier 2 once tier 3 is exhausted', () => {
      const random = jest.fn().mockReturnValue(0.99)

      const drawn = drawConstraints(4, random)

      expect(drawn.map(({ tier }) => tier)).toEqual([3, 2, 2, 2])
    })
  })
})
