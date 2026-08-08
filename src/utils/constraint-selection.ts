import {
  categoryConstraintTiers,
  constraintModifiers,
  tier2CategoryConstraints,
  TierDefinition,
  twinSuffix,
  wildcardConstraint,
} from '../assets/constraints'
import { modifierChance, twinMechanicChance, wildcardSlotChance } from '../config'

export interface DrawnConstraint {
  constraint: string
  tier: 1 | 2 | 3
}

// Math.floor(roll * length) yields length itself when roll is exactly 1. Math.random never returns
// 1, but every generator here is injected, so clamp rather than trust the caller.
const pickIndex = (roll: number, length: number): number => Math.min(length - 1, Math.floor(roll * length))

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
// `exclude` seeds the used set so a caller that has already placed a pattern by hand (the twin
// slots) does not get it back as an ordinary slot.
export const drawConstraints = (count: number, random: () => number, exclude: string[] = []): DrawnConstraint[] => {
  const drawn: DrawnConstraint[] = []
  const used = new Set<string>(exclude)
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
    const constraint = source[pickIndex(random(), source.length)]
    tierThreeUsed = tierThreeUsed || tier.tier === 3
    used.add(constraint)
    drawn.push({ constraint, tier: tier.tier })
  }

  return drawn
}

// Every special roll is consumed unconditionally and up front, in this fixed order:
//   1. wildcard  2. twin  3. twin pattern  4. modifier  5. modifier slot index  6. modifier choice
// drawConstraints then takes two rolls per remaining slot. Consumption therefore depends only on
// the slot count, never on which branch was taken, so a caller (or a test) can reason about the
// sequence without simulating the branches.
export const selectCategoryConstraints = (count: number, random: () => number): string[] => {
  const wildcardRoll = random()
  const twinRoll = random()
  const twinPatternRoll = random()
  const modifierRoll = random()
  const modifierIndexRoll = random()
  const modifierChoiceRoll = random()

  const useWildcard = wildcardRoll < wildcardSlotChance
  // Mutually exclusive with the wildcard: at most one structural special per game bounds variance.
  const useTwin = !useWildcard && twinRoll < twinMechanicChance
  // Twins are tier 2 only. A twin homophone or twin anagram pair would be exactly the gimmicky
  // output this work is trying to reduce.
  const twinPattern = tier2CategoryConstraints[pickIndex(twinPatternRoll, tier2CategoryConstraints.length)]

  const selected: string[] = []
  if (useWildcard) {
    selected.push(wildcardConstraint)
  }
  if (useTwin) {
    const twin = twinPattern + twinSuffix
    selected.push(twin, twin)
  }
  // Keep the twin's base pattern out of the ordinary draw: a third slot on the same pattern gives
  // three sibling categories, two marked TWIN and one not, which reads as a generation bug.
  const excluded = useTwin ? [twinPattern] : []
  selected.push(...drawConstraints(count - selected.length, random, excluded).map(({ constraint }) => constraint))

  if (modifierRoll >= modifierChance) {
    return selected
  }

  // Skip the special slots. The wildcard is already an open instruction to invent a pattern, so
  // layering a modifier on it compounds ambiguity instead of adding variety. The twin pair must
  // stay byte-identical -- modifying one half would leave two categories that are supposed to be
  // matched instances of one pattern carrying different instructions, which defeats the point.
  const firstModifiable = useWildcard ? 1 : useTwin ? 2 : 0
  const modifiableCount = count - firstModifiable
  // A twin in a 2-slot game leaves nothing modifiable; skip rather than index out of range.
  if (modifiableCount < 1) {
    return selected
  }
  const target = firstModifiable + pickIndex(modifierIndexRoll, modifiableCount)
  const modifier = constraintModifiers[pickIndex(modifierChoiceRoll, constraintModifiers.length)]
  return selected.map((constraint, index) => (index === target ? `${constraint} ${modifier}` : constraint))
}
