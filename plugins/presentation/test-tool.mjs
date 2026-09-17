// PURPOSE: Self-test for the `presentation` tool's RESULT CONTRACT — the harness
//          serialises a tool result as lossless JSON and refuses a value that
//          carries `undefined`, so this test asserts the payload never does and
//          that every failure mode is reported instead of thrown.
// INPUTS: none. Run: node plugins/presentation/test-tool.mjs
// OUTPUTS: one JSON summary on stdout; exit 0 when every case holds, 1 otherwise.
// KEYWORDS: presentation, tool, test, lossless-json, regression, self-check.
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { presentationTool } from './plugin-presentation.mjs'

const cases = []
const check = (name, condition, detail) => cases.push({ name, ok: Boolean(condition), detail })

/**
 * Finds the first `undefined` anywhere in a value.
 * A payload carrying one cannot survive the harness's lossless-JSON encoder, which
 * is how a successful call once failed to reach the model at all.
 * @param value - The payload to walk.
 * @param path - Human-readable location, used in the returned string.
 * @returns The path of the first `undefined`, or null when the value is clean.
 */
function firstUndefined(value, path = '') {
  if (value === undefined) return path || '(root)'
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = firstUndefined(value[index], `${path}[${index}]`)
      if (found !== null) return found
    }
    return null
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const found = firstUndefined(entry, path === '' ? key : `${path}.${key}`)
      if (found !== null) return found
    }
    return null
  }
  return null
}

const config = presentationTool((definition) => definition)
const cwd = mkdtempSync(join(tmpdir(), 'presentation-tool-'))
const call = (args) => config.execute(args, { agent: { session: { header: { cwd } } } })

const spec = {
  theme: 'mono',
  title: 'Контракт результата',
  slides: [
    { type: 'cover', kicker: 'Тест', title: 'Колода ==из теста==' },
    { kicker: 'Блоки', title: 'Второй', cards: [{ title: 'A', text: 'B' }], callout: 'C' }
  ]
}

// ── the happy path: a real file, and a payload the harness can encode ─────────
const good = await call({ spec: JSON.stringify(spec), out: 'nested/deck.html' })
check('ok on a valid spec', good.ok === true, JSON.stringify(good).slice(0, 120))
check('a clean deck is not degraded', good.degraded === false, String(good.degraded))
check('no undefined anywhere (this is the harness rule)', firstUndefined(good) === null, String(firstUndefined(good)))
check('path is absolute', good.path.startsWith('/'), good.path)
check('resolves a relative name against the session cwd', good.path === join(cwd, 'nested/deck.html'), good.path)
check('reports the theme', good.theme === 'mono', good.theme)
check('reports the slide count', good.slides === 2, String(good.slides))
check('inside the workspace carries no flag', !('outsideWorkspace' in good) && !('outsideWorkspace' in Object.fromEntries(Object.entries(good).filter(([, v]) => v !== undefined))), 'absent key')
check('the file exists', existsSync(good.path))
check('the bytes it reports are the bytes on disk', statSync(good.path).size === good.bytes, `${good.bytes}`)
check('the document is standalone', readFileSync(good.path, 'utf8').startsWith('<!doctype html>'))

// ── an absolute path outside the workspace is flagged, still lossless ─────────
const outside = await call({ spec: JSON.stringify(spec), out: join(tmpdir(), 'presentation-outside.html') })
check('outside workspace is flagged', outside.ok === true && outside.outsideWorkspace === true, JSON.stringify(outside.outsideWorkspace))
check('outside payload has no undefined', firstUndefined(outside) === null, String(firstUndefined(outside)))

// ── failure modes are reported, never thrown, and stay lossless ──────────────
const badJson = await call({ spec: 'not json' })
check('invalid JSON is reported', badJson.ok === false && /invalid JSON/.test(badJson.errors[0]), badJson.errors[0])
check('invalid JSON payload has no undefined', firstUndefined(badJson) === null, String(firstUndefined(badJson)))

const empty = await call({ spec: '   ' })
check('blank spec is reported', empty.ok === false && /non-empty/.test(empty.errors[0]), empty.errors[0])

const noSlides = await call({ spec: JSON.stringify({ title: 'x' }) })
check('missing slides is reported', noSlides.ok === false && noSlides.errors.length > 0, JSON.stringify(noSlides.errors))
check('missing-slides payload has no undefined', firstUndefined(noSlides) === null, String(firstUndefined(noSlides)))

const badType = await call({ spec: JSON.stringify({ slides: [{ type: 'chart', title: 'X' }] }), out: 'typed.html' })
check('unknown slide type still writes', badType.ok === true && existsSync(join(cwd, 'typed.html')))
check('unknown slide type is named in errors', badType.errors.some((e) => /slide 1/.test(e) && /chart/.test(e)), JSON.stringify(badType.errors))
check('unknown-type payload has no undefined', firstUndefined(badType) === null, String(firstUndefined(badType)))
check('a fallback slide marks the deck degraded', badType.degraded === true, String(badType.degraded))
check('degraded agrees with errors on every success',
  [good, outside, badType].every((value) => value.degraded === (value.errors.length > 0)))
check('a failure payload carries no degraded flag',
  !('degraded' in badJson) && !('degraded' in empty) && !('degraded' in noSlides))

const everyPayload = [good, outside, badJson, empty, noSlides, badType]
check('every payload survives a JSON round trip unchanged',
  everyPayload.every((value) => JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value)))

const failed = cases.filter((c) => !c.ok)
console.log(JSON.stringify({
  unit: 'presentation-tool',
  cwd,
  total: cases.length,
  failed: failed.length,
  cases: cases.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail }))
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
