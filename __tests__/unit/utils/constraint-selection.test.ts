import {
  constraintModifiers,
  tier1CategoryConstraints,
  tier2CategoryConstraints,
  tier3CategoryConstraints,
  twinSuffix,
  wildcardConstraint,
} from '@assets/constraints'
import { drawConstraints, selectCategoryConstraints } from '@utils/constraint-selection'

const mockSequence = (values: number[]) => {
  let index = 0
  return () => {
    const value = values[index] ?? 0
    index += 1
    return value
  }
}

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

    it('should stay in range for an injected generator that returns out-of-range rolls', () => {
      const outOfRange = jest.fn(mockSequence([-1, -0.5, 2, 1, -3, 1.5, 0, 0]))

      const drawn = drawConstraints(4, outOfRange)

      expect(drawn.every(({ constraint }) => typeof constraint === 'string')).toEqual(true)
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

    it('should not draw an excluded constraint', () => {
      const random = jest.fn().mockReturnValue(0)

      const drawn = drawConstraints(1, random, [tier1CategoryConstraints[0]])

      expect(drawn).toEqual([{ constraint: tier1CategoryConstraints[1], tier: 1 }])
    })

    it('should still consume two random values per slot when excluding', () => {
      const random = jest.fn().mockReturnValue(0)

      drawConstraints(4, random, [tier1CategoryConstraints[0]])

      expect(random).toHaveBeenCalledTimes(8)
    })
  })

  describe('selectCategoryConstraints', () => {
    // Rolls, in order: wildcard, twin, twin pattern, modifier, modifier slot index, modifier
    // choice, then two per drawn slot.
    const noSpecials = (slotRolls: number[] = []) => jest.fn(mockSequence([0.99, 0.99, 0, 0.99, 0, 0, ...slotRolls]))
    const wildcardOnly = (slotRolls: number[] = []) => jest.fn(mockSequence([0, 0.99, 0, 0.99, 0, 0, ...slotRolls]))
    const twinOnly = (slotRolls: number[] = []) => jest.fn(mockSequence([0.99, 0, 0, 0.99, 0, 0, ...slotRolls]))

    it('should return exactly one constraint per slot', () => {
      const selected = selectCategoryConstraints(4, noSpecials())

      expect(selected).toHaveLength(4)
      expect(new Set(selected).size).toEqual(4)
    })

    it('should insert a wildcard slot when the wildcard roll hits', () => {
      expect(selectCategoryConstraints(4, wildcardOnly())[0]).toEqual(wildcardConstraint)
    })

    it('should still fill every slot when the wildcard fires', () => {
      expect(selectCategoryConstraints(4, wildcardOnly())).toHaveLength(4)
    })

    it('should not use a twin slot when the wildcard slot fired', () => {
      const random = jest.fn(mockSequence([0, 0, 0, 0.99, 0, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected.filter((entry) => entry.includes(twinSuffix))).toHaveLength(0)
    })

    it('should produce two identical twin slots on the same tier 2 pattern when the twin roll hits', () => {
      const selected = selectCategoryConstraints(4, twinOnly())
      const twins = selected.filter((entry) => entry.includes(twinSuffix))

      expect(selected).toHaveLength(4)
      expect(twins).toHaveLength(2)
      expect(twins[0]).toEqual(twins[1])
      expect(twins[0]).toEqual(tier2CategoryConstraints[0] + twinSuffix)
    })

    it('should draw the twin pattern from tier 2 for a high twin pattern roll', () => {
      const random = jest.fn(mockSequence([0.99, 0, 0.99, 0.99, 0, 0]))

      const twins = selectCategoryConstraints(4, random).filter((entry) => entry.includes(twinSuffix))

      expect(twins[0]).toEqual(tier2CategoryConstraints[tier2CategoryConstraints.length - 1] + twinSuffix)
    })

    it('should not draw the twin base pattern into any other slot', () => {
      // Both remaining slots roll into tier 2 at index 0 of whatever is still available.
      const selected = selectCategoryConstraints(4, twinOnly([0.8, 0, 0.8, 0]))

      expect(selected.filter((entry) => entry.includes(tier2CategoryConstraints[0]))).toHaveLength(2)
      expect(new Set(selected).size).toEqual(3)
    })

    it('should apply a modifier to exactly one slot when the modifier roll hits', () => {
      const random = jest.fn(mockSequence([0.99, 0.99, 0, 0, 0, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected).toHaveLength(4)
      expect(selected.filter((entry) => entry.includes(constraintModifiers[0]))).toHaveLength(1)
      expect(selected[0]).toEqual(`${tier1CategoryConstraints[0]} ${constraintModifiers[0]}`)
    })

    it('should choose the modifier with the modifier choice roll', () => {
      const random = jest.fn(mockSequence([0.99, 0.99, 0, 0, 0, 0.99]))

      const selected = selectCategoryConstraints(4, random)

      expect(
        selected.filter((entry) => entry.includes(constraintModifiers[constraintModifiers.length - 1])),
      ).toHaveLength(1)
    })

    it('should never apply a modifier to the wildcard slot', () => {
      const random = jest.fn(mockSequence([0, 0.99, 0, 0, 0, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected[0]).toEqual(wildcardConstraint)
      expect(selected.filter((entry) => entry.includes(constraintModifiers[0]))).toHaveLength(1)
      expect(selected[1]).toContain(constraintModifiers[0])
    })

    it('should clamp a modifier slot index roll of one to the last slot', () => {
      const random = jest.fn(mockSequence([0, 0.99, 0, 0, 1, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected[0]).toEqual(wildcardConstraint)
      expect(selected.filter((entry) => entry.includes(constraintModifiers[0]))).toHaveLength(1)
      expect(selected[3]).toContain(constraintModifiers[0])
    })

    it('should consume six special rolls plus two per drawn slot', () => {
      const random = noSpecials()

      selectCategoryConstraints(4, random)

      expect(random).toHaveBeenCalledTimes(14)
    })

    it('should consume the same six special rolls when the wildcard fires', () => {
      const random = wildcardOnly()

      selectCategoryConstraints(4, random)

      expect(random).toHaveBeenCalledTimes(12)
    })

    it('should consume the same six special rolls when the twin fires', () => {
      const random = twinOnly()

      selectCategoryConstraints(4, random)

      expect(random).toHaveBeenCalledTimes(10)
    })
    it('should never modify only one half of a twin pair', () => {
      // wildcard miss, twin hit, twin pattern, modifier HIT, index 0, choice 0
      const random = jest.fn(mockSequence([0.99, 0, 0, 0, 0, 0]))

      const selected = selectCategoryConstraints(4, random)
      const twins = selected.filter((entry) => entry.includes(twinSuffix))

      expect(twins).toHaveLength(2)
      expect(twins[0]).toEqual(twins[1])
    })

    it('should still apply a modifier to a non-twin slot when a twin fires', () => {
      const random = jest.fn(mockSequence([0.99, 0, 0, 0, 0, 0]))

      const selected = selectCategoryConstraints(4, random)

      expect(selected.filter((entry) => entry.includes(constraintModifiers[0]))).toHaveLength(1)
    })
  })
})
