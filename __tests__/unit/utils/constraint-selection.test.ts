import {
  categoryConstraints,
  tier1CategoryConstraints,
  tier2CategoryConstraints,
  tier3CategoryConstraints,
} from '@assets/constraints'
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

    it('should draw distinct constraints even when every roll is identical', () => {
      const random = jest.fn().mockReturnValue(0)

      const constraints = drawConstraints(4, random).map(({ constraint }) => constraint)

      expect(new Set(constraints).size).toEqual(4)
    })

    it('should consume exactly two random values per slot', () => {
      const random = jest.fn().mockReturnValue(0.5)

      drawConstraints(4, random)

      expect(random).toHaveBeenCalledTimes(8)
    })
  })

  // The shim below is what getModelContext actually samples until the weighted draw is wired in.
  // A plain concat of the three tiers would silently hand tier 3 the same per-entry weight as
  // tier 1 and put a rare pattern in ~84% of games instead of ~49%. Nothing else in the suite
  // would catch that, because the games tests pin Math.random to 0 and therefore always select
  // index 0, which is identical in both pools.
  describe('categoryConstraints compatibility shim', () => {
    it('should preserve the original 4x/2x/1x tier weighting', () => {
      const count = (constraint: string) => categoryConstraints.filter((entry) => entry === constraint).length

      expect(count(tier1CategoryConstraints[0])).toEqual(4)
      expect(count(tier2CategoryConstraints[0])).toEqual(2)
      expect(count(tier3CategoryConstraints[0])).toEqual(1)
    })

    it('should keep tier 3 well below tier 1 in the sampled pool', () => {
      const shareOf = (tier: string[]) =>
        categoryConstraints.filter((entry) => tier.includes(entry)).length / categoryConstraints.length

      expect(shareOf(tier3CategoryConstraints)).toBeLessThan(shareOf(tier1CategoryConstraints) / 3)
    })
  })
})
