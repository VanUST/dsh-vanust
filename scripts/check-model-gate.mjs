/**
 * PURPOSE
 *   Enforce the deployment's cost policy at the one place a static check can decide it:
 *   the canonical composition the kit projects onto a machine.
 *
 *   `flash-only-models` says every agent, subagent and worker runs on a Flash-class
 *   DeepSeek model. The veto itself is the model-gate plugin's `llm/stream` listener, and
 *   the release gate is what proves that listener behaves — but the release gate composes
 *   a THROWAWAY profile from this repository's files, so it cannot notice that the row
 *   this deployment ships is disabled, widened, or pointed at a policy that no longer
 *   matches the pattern the packed plugin applies. That is the failure this script exists
 *   for: a machine converges on `profile/cordis.patch.yml` (kit-update.mjs copies it to
 *   `$DSH_HOME/profiles/web/cordis.patch.yml`), so a permissive row in this file is a
 *   permissive machine, and a wrong pattern here is a wrong pattern everywhere.
 *
 *   It decides four things, each from committed bytes:
 *     1. the canonical patch mounts the model-gate row and its configuration ENABLES it
 *        with one or more non-empty patterns;
 *     2. the pattern the PATCH configures is the pattern the PACKED PLUGIN applies — read
 *        out of the shipped tarball, not retyped here, so the two cannot drift;
 *     3. that pattern decides every fixture id as this deployment states it, by executing
 *        the regular expression over a hand-derived table that carries the reason for each
 *        expected answer — never by comparing the string to itself. The table includes the
 *        ids the CLASS pattern admits beyond the Flash tier's name, asserted as the stated
 *        trade-off rather than left out.
 *     4. the model picker the same patch configures advertises nothing the gate would
 *        refuse, so the composition cannot offer a model it would then veto.
 *
 * INPUTS
 *   None. Reads `profile/cordis.patch.yml`, the model-gate row of `plugins/inventory.json`
 *   and that row's tarball under `plugins/`, all relative to this script's own location.
 *   No network, no harness, no credentials, no child process and no temporary file.
 *
 * OUTPUTS
 *   One `[PASS]`/`[FAIL]` line per claim, then `model gate ok` and exit 0 when every claim
 *   holds; the failing claims on stderr and exit 1 otherwise. A caller that greps for the
 *   marker cannot mistake a partial run for a pass.
 *
 *   WHAT IT CANNOT DECIDE, stated here because a reader will otherwise assume it does:
 *   this is a claim about the REPOSITORY's canonical composition. It cannot prove that a
 *   live machine's `$DSH_HOME/profiles/<profile>/cordis.patch.yml` still carries this row
 *   (a machine-local patch layer or a hand edit can replace it), that a running server
 *   booted after the row was written (the profile composes once, at boot), or that a
 *   request reaching the provider went through this listener at all. `--dump-config` and
 *   the release gate measure the throwaway instance; nothing hermetic can measure a
 *   machine's live composition.
 *
 *   WHY THIS FILE IS NOT LISTED IN THE DEPLOYMENT PROCEDURE'S COMMAND BLOCK, which names
 *   every other check: that block is checked by `check-instruction-routing.mjs`, which
 *   fails when a script the procedure names does not exist, and the test that proves that
 *   claim (`scripts/test-ratchet.mjs`) copies a FIXED list of files into its fixture — so
 *   naming a script there without adding it to that list breaks the test's own
 *   pass-over-an-intact-copy assertion. The enforcement point is this script's `model-gate`
 *   verification entry in `.dsh/project.json`, which is what `context_rules` reads and what
 *   the gate runs; adding it to the procedure means adding
 *   `scripts/check-model-gate.mjs` to that test's `parts` list at the same time.
 *
 * KEYWORDS
 *   model gate, cost policy, flash-only, allow-list, profile patch, composition, enforcement
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing patch, inventory, tarball or pattern is a FAILURE, never a skip: every
 *     claim here is about bytes that must exist, and "I could not read it" is not "it is
 *     fine". The script never reports a pass it did not decide.
 *   - A pattern that cannot be compiled is reported as the unusable configuration it is
 *     rather than throwing out of here, and an absent or empty pattern list is reported as
 *     a failure rather than evaluated as "nothing to check".
 *   - Each fixture names the answer it expects AND why, so a fixture that lands on the
 *     wrong side prints both the id and the reasoning it contradicts, and a pattern that
 *     admits everything (or nothing) fails the table rather than passing half of it.
 *   - A patch with no `llm-deepseek` `models` list is a failure rather than an empty pass:
 *     the picker claim is about a list that must be present and non-empty.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const failures = []
const claim = (name, ok, detail) => {
  process.stdout.write(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
  if (!ok) failures.push(`${name}: ${detail ?? 'no detail'}`)
}

/** Reads a kit file, or reports it as missing rather than throwing. */
function read(relative) {
  const path = join(KIT, relative)
  if (!existsSync(path)) return { missing: true, path }
  return { text: readFileSync(path, 'utf8'), path }
}

/**
 * Read the regular-file entries of a gzipped tar as a `name -> bytes` map.
 *
 * A tarball is read in pure Node rather than by spawning `tar`, so this check stays
 * hermetic and behaves the same on both platforms the kit ships to. The reader is
 * deliberately partial: it returns null when the archive cannot be parsed, so the caller
 * reports an unreadable tarball instead of treating "no entries compared" as agreement.
 * Directory entries, GNU long names and PAX headers are skipped; their bodies are still
 * sized correctly, so a later entry is not misread.
 *
 * @param archive - absolute path to a `.tgz`.
 * @returns `Map<string, Buffer>` keyed by the path inside the archive (`package/…`), or
 *   null when it cannot be read or parsed.
 */
function readTarball(archive) {
  let raw
  try {
    raw = gunzipSync(readFileSync(archive))
  } catch {
    return null
  }
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '')
    const name = field(0, 100)
    const prefix = field(345, 155)
    const size = parseInt(field(124, 12).trim(), 8)
    const type = String.fromCharCode(header[156])
    if (name === '' || !Number.isFinite(size) || size < 0) return null
    offset += 512
    if (type === '0' || type === '\0') {
      entries.set(prefix === '' ? name : `${prefix}/${name}`, raw.subarray(offset, offset + size))
    }
    offset += Math.ceil(size / 512) * 512
  }
  return entries.size > 0 ? entries : null
}

/** A list item: its indentation and the `id:` it declares, if any. */
const listItem = (line) => {
  const match = /^(\s*)-\s+(.*?)\s*$/.exec(line)
  if (match === null) return null
  const id = /^id:\s*(.*?)\s*$/.exec(match[2])
  return { indent: match[1].length, body: match[2], id: id === null ? null : id[1].replace(/^['"]|['"]$/g, '') }
}

/**
 * Isolate one patch row: the lines of the `- id: <rowId>` entry.
 *
 * The patch is a YAML list of patch entries, and a row may sit INSIDE another entry — the
 * gate's own row is a list item under a top-level `- insert:` — so a row is located by its
 * `id:` at any indentation and closed by the next list item at the SAME OR SHALLOWER
 * indentation. Keying the boundary on indentation rather than on a fixed top-level `- `
 * is what keeps a key belonging to a later row out of this one.
 *
 * @param text - the whole patch file.
 * @param rowId - the row id to isolate.
 * @returns `{ indent, body }` where body is the row's own lines, or null when absent.
 */
function patchRow(text, rowId) {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const item = listItem(lines[index])
    if (item === null || item.id !== rowId) continue
    const body = []
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const next = listItem(lines[scan])
      if (next !== null && next.indent <= item.indent) break
      body.push(lines[scan])
    }
    return { indent: item.indent, body }
  }
  return null
}

/**
 * Recover a scalar configured in one patch row.
 *
 * @param text - the whole patch file.
 * @param rowId - the row id to isolate.
 * @param key - the key to read.
 * @returns the raw inline scalar as written (quotes stripped), or null when absent. A key
 *   with no inline value (a nested block) reads as the empty string, which is not a value
 *   any caller here accepts.
 */
function patchScalar(text, rowId, key) {
  const row = patchRow(text, rowId)
  if (row === null) return null
  for (const line of row.body) {
    const match = new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`).exec(line)
    if (match !== null) return match[1].replace(/^['"]|['"]$/g, '')
  }
  return null
}

/**
 * Read a `- item` sequence nested under one configured key of one patch row.
 *
 * @param text - the whole patch file.
 * @param rowId - the row id to isolate.
 * @param key - the key whose sequence to collect.
 * @returns the item strings in order, or null when the key is absent. A key present with no
 *   items reads as an empty array, which a caller must treat as "nothing configured".
 */
function patchSequence(text, rowId, key) {
  const row = patchRow(text, rowId)
  if (row === null) return null
  let keyIndent = -1
  const items = []
  for (const line of row.body) {
    if (keyIndent === -1) {
      const keyLine = new RegExp(`^(\\s+)${key}:\\s*$`).exec(line)
      if (keyLine !== null) keyIndent = keyLine[1].length
      continue
    }
    const item = listItem(line)
    if (item !== null && item.indent > keyIndent) items.push(item.body.replace(/^['"]|['"]$/g, ''))
  }
  return keyIndent === -1 ? null : items
}

/**
 * Read the model ids advertised by one patch row's `models:` list.
 *
 * @param text - the whole patch file.
 * @param rowId - the row id to isolate.
 * @returns `{ id, name }` per advertised model, or null when the row declares no models
 *   list. An empty list reads as an empty array.
 */
function patchModelIds(text, rowId) {
  const row = patchRow(text, rowId)
  if (row === null) return null
  let modelsIndent = -1
  const advertised = []
  for (const line of row.body) {
    if (modelsIndent === -1) {
      const modelsLine = /^(\s+)models:\s*$/.exec(line)
      if (modelsLine !== null) modelsIndent = modelsLine[1].length
      continue
    }
    const entry = listItem(line)
    if (entry === null || entry.indent <= modelsIndent) continue
    const id = /^id:\s*(.*?)\s*$/.exec(entry.body)
    if (id !== null) {
      advertised.push({ id: id[1].replace(/^['"]|['"]$/g, ''), name: '' })
      continue
    }
    const nameLine = /^\s+name:\s*(.*?)\s*$/.exec(line)
    if (nameLine !== null && advertised.length > 0 && advertised[advertised.length - 1].name === '') {
      advertised[advertised.length - 1].name = nameLine[1].replace(/^['"]|['"]$/g, '')
    }
  }
  return modelsIndent === -1 ? null : advertised
}

// ── the plugin's own pattern, read from the bytes the kit ships ─────────────
// The inventory row is the only place that says WHICH tarball is the model gate, and
// check-portability.mjs is what verifies the tarball still agrees with its source. This
// script takes the row as given and reads the policy out of the packed artifact, because
// the packed artifact is what a machine installs.
const inventory = read('plugins/inventory.json')
let gateRow = null
if (inventory.missing === true) {
  claim('the plugin inventory is readable', false, inventory.path)
} else {
  try {
    gateRow = (JSON.parse(inventory.text).plugins ?? []).find((row) => row.package === '@deepseek-ai/dsh-model-gate') ?? null
    claim(
      'the inventory carries a model-gate row',
      gateRow !== null,
      gateRow === null ? 'no row with package @deepseek-ai/dsh-model-gate' : `id ${gateRow.id}, prefix ${gateRow.tarballPrefix}`,
    )
  } catch (error) {
    claim('the plugin inventory is readable', false, String(error))
  }
}

let packedPattern = null
if (gateRow !== null) {
  const tarballs = readdirSync(join(KIT, 'plugins')).filter(
    (name) => name.startsWith(`${gateRow.tarballPrefix}-`) && name.endsWith('.tgz'),
  )
  // Anything other than exactly one tarball is check-portability's finding; here it is
  // reported as its own claim so this script cannot silently compare against a guess.
  claim(
    'exactly one model-gate tarball is shipped',
    tarballs.length === 1,
    tarballs.length === 1 ? tarballs[0] : `found ${tarballs.length}: ${tarballs.join(', ')}`,
  )
  if (tarballs.length === 1) {
    const entries = readTarball(join(KIT, 'plugins', tarballs[0]))
    if (entries === null) {
      claim('the model-gate tarball is readable', false, `${tarballs[0]} is not a parseable tar`)
    } else {
      const manifest = entries.get('package/package.json')
      let main = null
      try {
        main = manifest === undefined ? null : JSON.parse(manifest.toString('utf8')).main ?? null
      } catch (error) {
        claim('the packed manifest is readable', false, String(error))
      }
      const entryName = typeof main === 'string' ? `package/${main}` : null
      const body = entryName === null ? undefined : entries.get(entryName)
      if (body === undefined) {
        claim('the tarball ships the entry point its manifest declares', false, `${tarballs[0]} has no ${entryName ?? 'main'}`)
      } else {
        // The packed default is read as a JSON string literal and decoded, so an escaped
        // backslash in the emitted code cannot be mistaken for a difference in policy.
        const match = /FLASH_CLASS_DEFAULT_PATTERN\s*=\s*("(?:[^"\\]|\\.)*")/.exec(body.toString('utf8'))
        if (match === null) {
          claim('the packed plugin declares its Flash-class pattern', false, `no FLASH_CLASS_DEFAULT_PATTERN assignment in ${entryName}`)
        } else {
          try {
            packedPattern = JSON.parse(match[1])
            claim('the packed plugin declares its Flash-class pattern', true, `${packedPattern} (from ${tarballs[0]})`)
          } catch (error) {
            claim('the packed plugin declares its Flash-class pattern', false, `unparseable literal ${match[1]}: ${String(error)}`)
          }
        }
      }
    }
  }
}

// ── the canonical composition enables the gate with that pattern ────────────
const patch = read('profile/cordis.patch.yml')
let configured = null
if (patch.missing === true) {
  claim('the canonical profile patch exists', false, patch.path)
} else {
  const mounted = /^\s*name:\s*'@deepseek-ai\/dsh-model-gate'\s*$/m.test(patch.text)
  claim(
    'the canonical patch mounts @deepseek-ai/dsh-model-gate',
    mounted,
    mounted ? 'row present' : 'no model-gate insert row',
  )
  // `apply()` returns immediately unless `enabled === true`, so a row that is mounted and
  // not enabled registers no listener at all: the deployment would read as gated and
  // dispatch anything.
  const enabled = patchScalar(patch.text, 'model-gate', 'enabled')
  claim(
    'the row enables the gate',
    enabled === 'true',
    enabled === 'true' ? 'config.enabled: true' : `config.enabled is ${enabled === null ? 'absent' : enabled}; a gate that is not enabled registers no listener`,
  )
  configured = patchSequence(patch.text, 'model-gate', 'allowedModelPatterns')
  const nonEmpty = Array.isArray(configured) && configured.length > 0 && configured.every((entry) => entry.length > 0)
  claim(
    'the row configures at least one non-empty allow-list pattern',
    nonEmpty,
    nonEmpty ? `${configured.length} pattern(s)` : `allowedModelPatterns is ${configured === null ? 'absent' : JSON.stringify(configured)}`,
  )
  // The plugin's own `compilePolicy` refuses an enabled gate with no matcher, so an empty
  // list here is a boot failure — a loud one, but still a broken composition.
  if (packedPattern !== null && nonEmpty) {
    const same = configured.length === 1 && configured[0] === packedPattern
    claim(
      'the pattern the patch configures is the pattern the packed plugin applies',
      same,
      same ? packedPattern : `patch: ${JSON.stringify(configured)}, packed: ${packedPattern}`,
    )
  }
}

// ── the configured pattern decides the policy, by execution ─────────────────
// Every expected value is derived by hand from the policy this deployment states and from
// what the loaded pattern actually decides, never computed from the pattern under test.
// The table is explicit per id rather than one admit-list and one refuse-list because the
// pattern is deliberately CLASS-based, and `^deepseek-(v[0-9.]+-)?flash(-[a-z0-9-]+)*$`
// admits an id whose segments START with `flash` — `deepseek-v4-flash-pro` matches. A
// fixture list that quietly asserted the opposite would fail on a deliberate design choice;
// one that quietly omitted the id would hide it. So it is asserted as the pattern's own
// documented risk, in the open.
const FIXTURES = [
  { model: 'deepseek-flash', admit: true, why: 'the active Flash id — the whole point of the gate' },
  { model: 'deepseek-v4-flash', admit: true, why: 'the deprecated Flash alias this deployment accepts' },
  { model: 'deepseek-v4-flash-vision-exp', admit: true, why: 'the vision Flash alias, admitted by the class pattern' },
  { model: 'deepseek-v4.1-flash', admit: true, why: 'a re-versioned Flash id needs no policy edit' },
  { model: 'deepseek-v5.1-flash', admit: true, why: 'a future Flash release needs no policy edit' },
  { model: 'deepseek-v4-flash-pro', admit: true, why: 'DOCUMENTED RISK: the class pattern admits any id with a `flash` first segment and a trailing qualifier, so a pro tier released UNDER a flash-named id would pass; this is the plugin\u2019s stated class-not-version trade-off, not a defect this check can repair' },
  { model: 'deepseek-v4-pro', admit: false, why: 'the pro tier is the tier this rule exists to refuse' },
  { model: 'deepseek-pro', admit: false, why: 'an unversioned pro id is refused too' },
  { model: 'deepseek-v4-pro-flash', admit: false, why: 'a pro id ending in `flash` is refused: `pro` is the FIRST segment and the pattern anchors on `deepseek-`' },
  { model: 'deepseek-v4-reasoner', admit: false, why: 'a non-Flash tier that is neither flash- nor pro-named' },
  { model: 'flash', admit: false, why: 'a bare `flash` is not a DeepSeek id' },
  { model: 'deepseek-flashx', admit: false, why: 'the pattern anchors at the end, so a suffixed near-miss is refused' },
  { model: 'deepseek-v4-flas', admit: false, why: 'a truncated Flash id is refused' },
  { model: 'openai/deepseek-flash', admit: false, why: 'a provider-prefixed id is not admitted by the pattern' },
  { model: 'deepseek-flash ', admit: false, why: 'trailing whitespace is a different string, so it is refused rather than silently trimmed' },
  { model: 'deepseek-v4-pro ', admit: false, why: 'the same for the pro id' },
  { model: 'gpt-5', admit: false, why: 'a non-DeepSeek model is refused' },
]
const sources = Array.isArray(configured) && configured.length > 0 ? configured : packedPattern === null ? [] : [packedPattern]
if (sources.length === 0) {
  claim('the model gate policy runs against fixtures', false, 'no pattern was available to compile')
} else {
  let policy = null
  try {
    const patterns = sources.map((source) => new RegExp(source))
    policy = (model) => patterns.some((pattern) => pattern.test(model))
  } catch (error) {
    claim('the model gate policy runs against fixtures', false, `pattern does not compile: ${String(error)}`)
  }
  if (policy !== null) {
    const wrong = FIXTURES.filter((fixture) => policy(fixture.model) !== fixture.admit)
    claim(
      'the policy decides every stated Flash-class fixture as this deployment states it',
      wrong.length === 0,
      wrong.length === 0
        ? `${FIXTURES.length} fixture(s) decided as stated (${FIXTURES.filter((f) => f.admit).length} admitted, ${FIXTURES.filter((f) => !f.admit).length} refused)`
        : wrong.map((fixture) => `${fixture.model} was ${fixture.admit ? 'refused' : 'admitted'}: ${fixture.why}`).join(' | '),
    )
  }
}

// ── the picker offers nothing the gate would refuse ─────────────────────────
// The same patch narrows the model picker to the current Flash model. A picker row the
// gate refuses is a UI that offers a choice which then fails at dispatch — the two halves
// of one composition, so they are checked together.
if (patch.missing === true) {
  claim('the picker advertises only what the gate admits', false, 'the canonical patch is missing')
} else if (sources.length === 0) {
  claim('the picker advertises only what the gate admits', false, 'no gate policy was available to judge the picker')
} else {
  const advertised = patchModelIds(patch.text, 'llm-deepseek')
  if (advertised === null || advertised.length === 0) {
    claim(
      'the picker advertises only what the gate admits',
      false,
      advertised === null ? 'the llm-deepseek row declares no models list' : 'the llm-deepseek models list is empty',
    )
  } else {
    const patterns = sources.map((source) => new RegExp(source))
    const refused = advertised.filter((model) => !patterns.some((pattern) => pattern.test(model.id))).map((model) => model.id)
    claim(
      'the picker advertises only what the gate admits',
      refused.length === 0,
      refused.length === 0 ? `${advertised.length} advertised model(s), all admitted` : `advertised but refused by the gate: ${refused.join(', ')}`,
    )
  }
}

if (failures.length > 0) {
  process.stderr.write(`model gate FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('model gate ok\n')
