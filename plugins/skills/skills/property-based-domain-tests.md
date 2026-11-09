# Property-based domain tests

An example test proves the cases you thought of. A music domain is combinatorial:
twelve roots, seven qualities, every integer shift, enharmonic spellings, flat
inputs, negative transposition, and a parser that must round-trip. `fast-check`
generates the cases, shrinks a failure to its smallest counterexample, and hands
you the seed to replay it.

Use it with Vitest for pure logic: chords, transposition, parsing, quantising,
timing arithmetic. Use Playwright for the screen; the two do not substitute.
`npx vitest run` is the same command in PowerShell, cmd and bash; only
environment-variable syntax differs (`$env:NAME` versus `NAME=value`).

## The invariants, not the examples

State properties a musician would accept as true, then let the generator look for
a violation:

| Property | Statement |
|---|---|
| round-trip | transpose(transpose(c, n), -n) === c |
| quality | transposition keeps the chord quality |
| intervals | pitch-class intervals relative to the root are unchanged |
| additivity | transpose(transpose(c, a), b) === transpose(c, a + b) |
| render/parse | parse(render(chord)) === chord for every legal chord |
| rejection | a non-integer shift or unknown root throws, it does not guess |

## A generator that reaches the interesting cases

Generate from your own vocabulary. `fc.string()` spends almost every run in the
parser's throw path and proves nothing:

```js
const chordArb = fc
  .record({
    root: fc.constantFrom(...NOTES),
    quality: fc.constantFrom(...Object.keys(QUALITIES)),
  })
  .map(renderChord)

const shiftArb = fc.integer({ min: -48, max: 48 })
```

```js
fc.assert(
  fc.property(chordArb, shiftArb, (chord, shift) => {
    expect(transposeChord(transposeChord(chord, shift), -shift)).toBe(chord)
  }),
  { numRuns: 500 },
)
```

Every row above deserves its own `it`, or the table promises coverage the suite
does not have. Additivity is the easy one to forget:

```js
fc.assert(
  fc.property(
    chordArb,
    fc.integer({ min: -24, max: 24 }),
    fc.integer({ min: -24, max: 24 }),
    (chord, a, b) => {
      expect(transposeChord(transposeChord(chord, a), b))
        .toBe(transposeChord(chord, a + b))
    },
  ),
)
```

Test the same module the app imports. If the property test carries a second
implementation, it tests the second implementation.

## Read a failure

When a property fails, fast-check shrinks and prints:

```
Property failed after 1 tests
{ seed: 471686226, path: "0:0:0:0", endOnFailure: true }
Counterexample: ["C7",0]
Shrunk 3 time(s)
Caused by: AssertionError: expected 'D7' to be 'C7'
```

That is a bug report: chord, shift, seed. Replay with `{ seed: 471686226 }`, fix,
then keep the seed only if the case is genuinely subtle.

## Prove the test can fail

A passing property proves nothing until you have seen it go red. Change one
production line — `+ shift` to `+ shift + 1` — run the suite, read the
counterexample, revert:

```bash
npx vitest run
# 1 failed | 3 passed — Counterexample: ["C7",0]
```

Revert and rerun; it must be green again. If the mutation survives, the property
is restating the implementation.

## Pitfalls

- **Generating invalid data** and filtering it with `fc.pre` until the run is
  mostly skips. Build valid generators instead.
- **One huge property.** When it fails you cannot tell which rule broke. One
  property per invariant.
- **`numRuns` left at the default for a cheap domain.** 100 is fine for a fast
  predicate; 500 is cheap here.
- **No seed in CI.** Log the seed and `path`; without them a red run is not
  reproducible.
- **Asserting calls, not behaviour.** `expect(transposeChord).toHaveBeenCalled()`
  proves the wiring, not the music.
- **Using it for UI.** Rendering, focus and layout are Playwright's; property
  tests cannot see them.

## Sources

fast-check 4.10 [quick start](https://fast-check.dev/docs/tutorials/quick-start/)
and [built-in arbitraries](https://fast-check.dev/docs/core-blocks/arbitraries/);
Vitest 5.1 [test API](https://vitest.dev/api/). The verified run used
`vitest 5.1.0`, `fast-check 4.10.2` and Node 24.
