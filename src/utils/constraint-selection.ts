import { categoryConstraintTiers, TierDefinition } from '../assets/constraints'

export interface DrawnConstraint {
  constraint: string
  tier: 1 | 2 | 3
}

const pickTier = (tiers: TierDefinition[], roll: number): TierDefinition => {
  const total = tiers.reduce((sum, tier) => sum + tier.probability, 0)
  let remaining = roll * total
  for (const tier of tiers) {
    remaining -= tier.probability
    if (remaining < 0) {
      return tier
    }
  }
  return tiers[tiers.length - 1]
}

// Consumes exactly two random values per slot, so callers can reason about the sequence.
export const drawConstraints = (count: number, random: () => number): DrawnConstraint[] => {
  const drawn: DrawnConstraint[] = []
  let tierThreeUsed = false

  while (drawn.length < count) {
    const available = tierThreeUsed ? categoryConstraintTiers.filter(({ tier }) => tier !== 3) : categoryConstraintTiers
    const tier = pickTier(available, random())
    const constraint = tier.constraints[Math.floor(random() * tier.constraints.length)]
    tierThreeUsed = tierThreeUsed || tier.tier === 3
    drawn.push({ constraint, tier: tier.tier })
  }

  return drawn
}
