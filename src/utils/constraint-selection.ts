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

// Consumes exactly two random values per slot regardless of which branch is taken, so callers
// can reason about the sequence. Note the tier a given roll maps to depends on draw history:
// once tier 3 is spent it is removed from the pool and the remaining probabilities renormalize,
// so roll 0.95 is tier 3 on the first slot and tier 2 on later ones.
export const drawConstraints = (count: number, random: () => number): DrawnConstraint[] => {
  const drawn: DrawnConstraint[] = []
  const used = new Set<string>()
  let tierThreeUsed = false

  while (drawn.length < count) {
    const available = tierThreeUsed ? categoryConstraintTiers.filter(({ tier }) => tier !== 3) : categoryConstraintTiers
    const tier = pickTier(available, random())
    // Draw distinct patterns. Two slots on the same tier-1 constraint produce two unrelated
    // categories with no shared words, which the spec identifies as a cause of flat puzzles --
    // deliberate repetition is the twin slot's job, not an accident of sampling. Filtering the
    // pool rather than rejecting and resampling keeps consumption at exactly two rolls per slot.
    const pool = tier.constraints.filter((constraint) => !used.has(constraint))
    const source = pool.length > 0 ? pool : tier.constraints
    const constraint = source[Math.floor(random() * source.length)]
    tierThreeUsed = tierThreeUsed || tier.tier === 3
    used.add(constraint)
    drawn.push({ constraint, tier: tier.tier })
  }

  return drawn
}
