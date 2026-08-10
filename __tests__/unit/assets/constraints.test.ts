import { constraintModifiers, twinSuffix } from '@assets/constraints'

describe('constraints', () => {
  describe('constraintModifiers', () => {
    // pickIndex clamps an out-of-range roll, but not an empty list: pickIndex(roll, 0) returns 0 and
    // constraintModifiers[0] is then undefined, so the prompt receives the literal text
    // "<constraint> undefined" instead of failing loudly. The clamp comment at
    // constraint-selection.ts:16-18 claims that cannot happen; this is the case it does not cover.
    it('should never be empty', () => {
      expect(constraintModifiers.length).toBeGreaterThan(0)
    })

    // A duplicated entry has no symptom other than silently drawing at twice the intended weight.
    it('should hold no duplicate entries', () => {
      expect(new Set(constraintModifiers).size).toEqual(constraintModifiers.length)
    })

    // constraint-selection.ts appends a modifier to an already-drawn constraint, and
    // prompts/create-connections-game.txt:18 tells the model that a constraint CONTAINING a sentence
    // beginning "Additionally," carries an extra restriction running to the end of the string. This
    // asserts the marker that contract keys on. An entry missing it is not an error: the model just
    // ignores it, and the game comes back a constraint short with nothing in the logs to say so.
    it('should begin every modifier with the prefix the prompt keys on', () => {
      expect(constraintModifiers.filter((modifier) => !modifier.startsWith('Additionally, '))).toEqual([])
    })

    // constraint-selection.ts:113 joins with `${constraint} ${modifier}`. A wrapped literal would
    // inject a newline and its indentation straight into the prompt -- failing as silently as a
    // missing prefix, and likelier, since these strings are long enough to invite wrapping.
    it('should keep every modifier on one line with no wrapping artifacts', () => {
      expect(constraintModifiers.filter((modifier) => /[\n\r]|\s{2}/.test(modifier))).toEqual([])
    })
  })

  describe('twinSuffix', () => {
    // constraint-selection.ts:88 concatenates as `twinPattern + twinSuffix` with no separator, so
    // the leading space is the only thing keeping the pattern and the suffix from running together.
    // Same class of silent prompt corruption as a wrapped modifier, in the sibling constant.
    it('should begin with the space that separates it from the twin pattern', () => {
      expect(twinSuffix.startsWith(' ')).toBe(true)
    })
  })
})
