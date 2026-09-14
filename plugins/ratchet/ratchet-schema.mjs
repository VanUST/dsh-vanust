/**
 * Ratchet schema: what a valid project, ADR and law are, and the stable problem
 * codes that say which rule failed.
 *
 * This module decides identity and well-formedness, and nothing else. It does not
 * compile, resolve supersession into an active set, or look at code, so every
 * question it answers can be answered from one file plus the manifest. Keeping
 * that boundary is what makes the compiler and verifier testable without a
 * filesystem fixture apiece: they consume `readAdrs` output, not raw markdown.
 *
 * Three design rules are load-bearing here, and each exists because the previous
 * ratchet failed it:
 *
 * 1. **A file is an ADR only if it declares itself one.** The predecessor took
 *    the first four characters of any `.md` filename as a decision id, so
 *    `README.md` became a decision with id `READ` and no problem was reported.
 *    Identity now comes from the `id` frontmatter field, the filename must agree
 *    with it, and a file that does not parse is reported rather than skipped.
 * 2. **Supersession is declared, never inferred.** The predecessor regex-matched
 *    prose in a `## Status` section, so "Superseded by 9999" silently removed a
 *    live decision from review. Links are now an explicit `supersedes` list, and
 *    a dangling target is an error.
 * 3. **Absent, empty and unreadable are three different answers.** The
 *    predecessor reported `problems: []` for a project with no decisions
 *    directory at all, which read as "nothing wrong". Every absence here carries
 *    the code that names it.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Manifest path, relative to the project root. */
export const MANIFEST_PATH = '.dsh/project.json'

/** Path hash of the manifest, reported in every bundle so a report names its input. */
export const RATCHET_DIR_DEFAULT = 'docs/adrs'

/**
 * Every problem code the Ratchet can emit, with the condition it names.
 *
 * The set is closed and stable on purpose: a caller (or an agent reading the
 * report) branches on the code, so adding a code is a compatible change and
 * renaming one is not. `verify-upgrade.sh` asserts every emitted code is in this
 * table, which is what stops a code being invented at a call site.
 */
export const PROBLEM_CODES = Object.freeze({
  MANIFEST_MISSING: 'the manifest file does not exist',
  MANIFEST_INVALID: 'the manifest is not valid JSON, or its ratchet section is malformed',
  RATCHET_DISABLED: 'the manifest exists but declares the ratchet disabled',
  DIR_MISSING: 'a declared directory does not exist',
  DIR_NOT_A_DIRECTORY: 'a declared path exists but is not a directory',
  DIR_UNREADABLE: 'a declared directory exists but could not be listed',
  NO_VALID_ADRS: 'the decisions directory contains no file that parses as an ADR',
  LAWS_NONE: 'no law is in force, so there is nothing for verification to check',
  ADR_FILE_INVALID: 'an ADR filename does not match NNNN-slug.adr.md',
  ADR_UNREADABLE: 'an ADR file exists but could not be read',
  ADR_FRONTMATTER_MISSING: 'the file has no YAML frontmatter block',
  ADR_FRONTMATTER_INVALID: 'the frontmatter is not a flat mapping the parser understands',
  ADR_FIELD_MISSING: 'a mandatory frontmatter field is absent or empty',
  ADR_FIELD_INVALID: 'a field is present but its value is not one of the allowed forms',
  ADR_ID_MISMATCH: 'the frontmatter id does not match the filename prefix',
  ADR_ID_DUPLICATE: 'two ADR files declare the same id',
  ADR_SECTION_MISSING: 'a mandatory markdown section is absent',
  ADR_MISSING_REASONING: 'the Reasoning section is present but empty',
  ADR_SOURCE_MISSING: 'the declared source file does not exist',
  ADR_SOURCE_HASH_MISMATCH: 'the source file does not match the hash recorded in the ADR',
  ADR_SOURCE_HASH_FORM: 'the recorded source hash is not a sha256:<hex> value',
  ADR_SUPERSEDES_DANGLING: 'supersedes names an ADR id that does not exist',
  ADR_SUPERSEDES_CYCLE: 'supersedes links form a cycle',
  ADR_SUPERSEDES_SELF: 'an ADR supersedes itself',
  ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE: 'an agent-authored ADR is active in a human-owned zone',
  ADR_AGENT_REQUIRES_APPROVAL: 'an agent-authored ADR in a proposeOnly zone is not proposed',
  LAW_DUPLICATE: 'two active ADRs declare the same law id',
  LAW_CONFLICT: 'two active ADRs constrain the same law incompatibly',
  LAW_ZONE_MISSING: 'a law names a zone the manifest does not declare',
  LAW_TARGET_DANGLING: 'a law removes or amends a law id that no active ADR declares',
  LAW_REMOVE_UNAUTHORISED: 'a law removes a decision whose force came from a human ratification, without that authority',
  LAW_PATH_OUTSIDE_DECLARED_ZONE: 'a law enforces against a path its record does not govern',
  LAW_REMOVED_WITHOUT_DECISION: 'a law that was in force is gone and no active record removes it',
  LAW_UNCHECKED: 'a law in force declares no machine check and does not say why',
  SPEC_HASH_MISMATCH: 'a generated spec file was edited after generation',
  SPEC_OUT_OF_DATE: 'the generated spec bundle does not match the compiled laws',
  SPEC_ORPHANED: 'a generated spec file no longer corresponds to any law in force',
  ZONE_INVALID: 'a zone declaration is malformed',
  ZONE_PATH_INVALID: 'a zone glob is not a usable repository-relative pattern',
  ZONE_OVERLAP: 'two zones claim the same path with different authority',
  CODE_REQUIRED_FILE_MISSING: 'a required_file check found no such file',
  CODE_FORBIDDEN_FILE_PRESENT: 'a forbidden_file check found the file',
  CODE_REQUIRED_GLOB_MISSING: 'a required_glob check matched no file',
  CODE_FORBIDDEN_GLOB_PRESENT: 'a forbidden_glob check matched at least one file',
  CODE_REQUIRED_DEPENDENCY_MISSING: 'a required dependency is not declared',
  CODE_FORBIDDEN_DEPENDENCY_PRESENT: 'a forbidden dependency is declared',
  CODE_REQUIRED_TEXT_MISSING: 'a required_text check found no match',
  CODE_TEXT_FORBIDDEN_PRESENT: 'a forbidden_text check found a match',
  CODE_COMMAND_FAILED: 'a command check ran and did not exit zero',
  CODE_COMMAND_OUTPUT_MISMATCH: 'a command check ran and its output did not match what the law asserts about it',
  VERIFY_NOT_RUN: 'no verification report exists for the current spec hash',
  VERIFY_NOTHING_EVALUATED: 'a verification ran but evaluated no check, so it proves nothing about the code',
  VERIFY_INCOMPLETE: 'a verification left checks unevaluated, so it is not a pass',
  VERIFICATION_FAILED: 'the most recent verification of the current laws reported problems',
  DYNAMIC_REVIEW_REQUIRED: 'the static compiler decided the question needs a judgement',
  APPROVAL_TARGET_UNKNOWN: 'an approval ADR names a decision that no file in this project declares',
  RATIFICATION_UNPROVEN: 'an approval ADR carries nothing showing that a human saw and consented to the text it approves',
  RATIFICATION_STALE: 'a decision was edited after it was ratified, so the recorded consent does not cover the text now in the file',
})

/**
 * Canonical ADR statuses.
 *
 * `active` is the only status that contributes laws. `proposed` awaits a human,
 * `rejected` and `withdrawn` are terminal and contribute nothing, and
 * `superseded` means a later ADR replaced it. The set is closed so a typo is an
 * error rather than a status that silently contributes nothing.
 */
export const ADR_STATUSES = Object.freeze([
  'proposed',
  'active',
  'superseded',
  'rejected',
  'withdrawn',
])

/**
 * Problem codes that make a project UNUSABLE rather than merely unhappy.
 *
 * One list, in the module that owns the vocabulary, because two callers need the
 * same answer: the CLI's exit code (`2` for "nothing was checked") and the
 * ratification queue's `ok`. When only the CLI knew it, `ratchet pending` printed OK
 * and exited 0 over a corpus whose decisions directory did not exist.
 */
export const UNUSABLE_PROBLEM_CODES = Object.freeze([
  'MANIFEST_MISSING',
  'MANIFEST_INVALID',
  'RATCHET_DISABLED',
  'DIR_MISSING',
  'DIR_NOT_A_DIRECTORY',
  'DIR_UNREADABLE',
  'NO_VALID_ADRS',
])

/** The two authorities, ordered.
 *
 * `human` outranks `agent`. The order is encoded here once so no other module
 * re-derives it: an authority comparison written twice is a comparison that can
 * disagree with itself.
 */
export const AUTHORITIES = Object.freeze(['human', 'agent'])

/** ADR types. `adr` changes law; `approval` only activates another ADR. */
export const ADR_TYPES = Object.freeze(['adr', 'approval'])

/**
 * How a ratification was obtained.
 *
 * A closed vocabulary rather than a free-text field, for the same reason the
 * problem codes are closed: a reader branches on the value, and `user-question`
 * names one specific, checkable thing — the decision was put to the human as a
 * question whose answer the ratchet derives itself. A channel nobody has
 * implemented is not a channel, so this list grows by implementing one.
 */
export const RATIFICATION_CHANNELS = Object.freeze(['user-question'])

/** The recorded form of a content hash, e.g. `sha256:<64 hex>`. */
export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

/** Mandatory markdown sections, in the order they must appear. */
export const ADR_SECTIONS = Object.freeze(['Context', 'Decision', 'Reasoning', 'Consequences'])

/** Agent-authority policies a zone may declare, weakest first. */
export const AGENT_AUTHORITY_POLICIES = Object.freeze([
  'humanOnly',
  'proposeOnly',
  'activeIfNoConflict',
])

/** Default policy when a zone declares none: the safe middle. */
export const DEFAULT_AGENT_AUTHORITY = 'proposeOnly'

/** The only check types the verifier implements. */
export const CHECK_TYPES = Object.freeze([
  'required_file',
  'forbidden_file',
  'required_glob',
  'forbidden_glob',
  'required_text',
  'forbidden_text',
  'required_dependency',
  'forbidden_dependency',
  'path_boundary',
  // A text check over a glob rather than an explicit path list, with `exclude`
  // patterns. This is what lets a boundary law say "no file under plugins/ratchet
  // imports the harness except the adapter" instead of naming the files that exist
  // today and silently missing the next one.
  'required_text_glob',
  'forbidden_text_glob',
  // Presence in a JSON array, addressed by key path. Enforces packaging claims —
  // "this module ships" — which a text search cannot, because the manifest and the
  // module live in different files.
  'required_file_in_list',
  // Run a command and require a zero exit. The escape hatch for invariants no
  // filesystem pattern decides: atomicity, injection, "the tests that cover this
  // still pass". It is the only check that spawns a process, it runs only when the
  // caller supplies a runner, and without one it reports that it was NOT evaluated
  // rather than passing.
  //
  // An exit code is a weak claim on its own — a command that prints the wrong
  // answer and exits 0 satisfies it — so a check may also assert on what the
  // command SAID: `outputContains` / `outputNotContains` (literal, case-sensitive)
  // and `outputMatches` (a regular expression), read from stdout+stderr together
  // unless `stream` narrows them. The selected stream is tested as ONE string
  // exactly as the process wrote it, trailing newline included, so an anchored
  // pattern asserts the whole stream rather than one line of it. Exit code only
  // remains the default, so every law written before these fields existed keeps its
  // exact meaning.
  'command',
])

/** Streams a command check's output assertions may read. */
export const COMMAND_STREAMS = Object.freeze(['stdout', 'stderr', 'both'])

/**
 * Check types whose `pattern` is a REGULAR EXPRESSION.
 *
 * The distinction matters: `required_glob` and `forbidden_glob` spell a glob in the
 * same field, and a glob is not a valid regex — a double-star path segment fails to
 * compile as one — so a validator that compiled every `pattern` would reject every
 * correct glob law while believing it was being strict.
 */
/**
 * Which check field names the path a check acts on, per check type.
 *
 * One table, because the alternative was tried twice and failed twice. A cross-check that
 * enumerates the fields by hand missed the singular `path` (so `required_file` enforced on
 * a human-only path with nothing reported) and then missed `path_boundary`'s `zone` and
 * `deny` entirely (so a record declaring one zone could constrain another). Both were
 * found by an independent breaker, not by reading the code.
 *
 * The table is the only place the mapping exists: `checkTargets` reads it, and a test
 * fails when a type in {@link CHECK_TYPES} is missing from it, so adding a check type
 * without saying what path it acts on is a red test rather than a silent hole. A `[]`
 * entry is a positive claim — the type has no path target by design, which is true of the
 * dependency checks, whose `patterns` name packages rather than files, and of `command`.
 *
 * `command` is the honest boundary of this rule rather than a clean case. A shell command
 * can read or write any path it likes, and a `run` string is not statically reducible to
 * the set of paths it touches — that is undecidable in general, not merely unimplemented.
 * So this cross-check cannot constrain it, and an agent-authored command check whose `run`
 * names a reserved path is refused by nothing here. Its reach is bounded by the same thing
 * that bounds the guard's, which the design already states for the same reason: review. A
 * law that must be held to a zone should carry a path check for the path, and a command
 * check for the behaviour.
 *
 * `zonePaths` is not a field on the check. It stands for the paths of the zone the check
 * names in `check.zone`, resolved through the manifest, because a `path_boundary` makes
 * two path claims at once: it denies `deny` to that zone, so both halves reach a path.
 *
 * `required_file_in_list` names two paths, not one: the file that must be listed, and the
 * list it must appear in. Only the first was declared, so a `list` of
 * `../outside/list.json` was read from outside the project root with the cross-check
 * reporting nothing — found by a breaker, like every other omission in this table.
 */
export const CHECK_TARGET_FIELDS = Object.freeze({
  required_file: ['path'],
  forbidden_file: ['path'],
  required_file_in_list: ['path', 'list'],
  required_glob: ['pattern'],
  forbidden_glob: ['pattern'],
  required_text: ['paths'],
  forbidden_text: ['paths'],
  required_text_glob: ['paths'],
  forbidden_text_glob: ['paths'],
  path_boundary: ['deny', 'zonePaths'],
  command: [],
  required_dependency: [],
  forbidden_dependency: [],
})

export const REGEX_PATTERN_CHECK_TYPES = Object.freeze([
  'required_text',
  'forbidden_text',
  'required_text_glob',
  'forbidden_text_glob',
])

/**
 * Regular-expression flags a check may declare.
 *
 * Deliberately excludes `g` and `y`, which are STATEFUL: `test()` and `exec()` on a
 * `/g` regex advance `lastIndex`, so a matcher reused across files skips matches in
 * whichever file it reaches next. A law whose verdict depends on file order is not a
 * law, and one verifier run reported a correct `required_text_glob` law as violated
 * for exactly that reason. The remaining flags change what a pattern means without
 * changing what it matched before.
 */
export const REGEX_FLAGS = Object.freeze(['i', 'm', 's', 'u', 'd'])

/** Shortest `unenforced` note that is a reason rather than a token. */
export const MIN_UNENFORCED_LENGTH = 12

/** Frontmatter fields every ADR must declare, in reporting order. */
export const MANDATORY_ADR_FIELDS = Object.freeze([
  'id',
  'title',
  'type',
  'status',
  'author',
  'source',
  'zones',
  'laws',
])

/**
 * Builds one problem record.
 *
 * @param code - A key of {@link PROBLEM_CODES}.
 * @param message - Human-readable detail; must be self-contained, because the
 *   report is read by someone who has not read this file.
 * @param subject - The ADR id, law id, zone id or repository path the problem is
 *   about, or `null` for a whole-project problem.
 * @param extra - Additional fields merged into the record (a `path`, a `line`).
 * @returns A frozen problem record.
 */
export function problem(code, message, subject = null, extra = {}) {
  return Object.freeze({
    code,
    severity: 'error',
    subject,
    message,
    ...extra,
  })
}

/**
 * Reports whether a string is one of the allowed values.
 *
 * @param value - Candidate value of any type.
 * @param allowed - Allowed values.
 * @returns `true` when `value` is a string equal to an allowed value.
 */
function oneOf(value, allowed) {
  return typeof value === 'string' && allowed.includes(value)
}

/**
 * Normalises file text the way every downstream reader expects it.
 *
 * A repository that mixes CRLF and LF is normal, and a hash computed over
 * un-normalised bytes would change with a checkout's line-ending settings. The
 * normalisation is applied once, at read time, so no consumer has to remember it.
 *
 * @param text - Raw file contents.
 * @returns Text with a leading BOM stripped and CRLF collapsed to LF.
 */
export function normaliseText(text) {
  return String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/**
 * Parses a YAML frontmatter block.
 *
 * Deliberately a subset, not a YAML engine: the ADR format needs flat scalars,
 * nested mappings one level deep (`author`, `source`), comment lines, and lists
 * of scalars or of small mappings (`laws`). Anything outside that subset is
 * reported as `ADR_FRONTMATTER_INVALID` rather than guessed at, because a
 * silently mis-parsed law is worse than a rejected file.
 *
 * @param source - Full file text, already normalised.
 * @returns `{ data, problems }`; `data` is `null` when no frontmatter block was
 *   found, and `problems` explains every line the parser could not accept.
 */
export function parseFrontmatter(source) {
  const problems = []
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') {
    return { data: null, problems }
  }
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) {
    problems.push(
      problem(
        'ADR_FRONTMATTER_INVALID',
        'the frontmatter block opens with --- but is never closed by a second ---',
      ),
    )
    return { data: null, problems }
  }

  /**
   * Reduces one scalar token to a JavaScript value.
   *
   * Quoted strings keep their text verbatim, so a value that looks like a number,
   * a boolean or a list stays a string; unquoted tokens are matched against the
   * YAML spellings this format uses and are otherwise kept as strings. An inline
   * `[a, b]` becomes an array.
   */
  const scalar = (raw) => {
    const value = raw.trim()
    // A quoted scalar is unescaped, because the format's quotes exist to carry text
    // the bare form cannot. Keeping the backslashes verbatim meant `run: "node -e
    // \"…\""` reached the command runner as an argument CONTAINING quote characters:
    // node evaluated a string literal, exited 0, and the law was reported checked
    // while the command it names never ran.
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1)
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim()
      return inner.length === 0 ? [] : inner.split(',').map((entry) => scalar(entry))
    }
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === 'null' || value === '~') return null
    // A bare integer becomes a number, because a law's `timeoutMs`, an ADR's
    // `manifestVersion` and any other numeric field is written unquoted in YAML and
    // a string there would be rejected by the very validation that reads it — which
    // is how eleven `timeoutMs: 300000` values were reported as invalid.
    //
    // Only INTEGERS, and only when the text is exactly a number: coercing `1.2.3` or
    // a leading-zero id such as `007` would turn a string field into a wrong value,
    // and an ADR id is not a number.
    if (/^-?(0|[1-9][0-9]*)$/.test(value)) return Number(value)
    return value
  }

  /** Indentation width of a line, or Infinity for a blank or comment line. */
  const depthOf = (line) => {
    if (line.trim().length === 0 || line.trim().startsWith('#')) return Number.POSITIVE_INFINITY
    return line.length - line.trimStart().length
  }

  /** Index of the next significant line at or after `from`, ignoring blanks and comments. */
  const nextSignificant = (from) => {
    for (let index = from; index < end; index += 1) {
      if (depthOf(lines[index]) !== Number.POSITIVE_INFINITY) return index
    }
    return -1
  }

  /**
   * Recursive block reader.
   *
   * Two shapes exist at any indentation: a MAPPING (`key: <scalar | child block>`)
   * and a SEQUENCE (`- <scalar | inline mapping | child block>`). The shape is
   * decided by the first significant line at the block's own indent, and the block
   * ends at the first line indented less. Because a law payload nests four levels
   * deep (laws, a law, checks, a check, patterns), a reader that understood only
   * two levels mis-parsed every law — which is what the previous version did.
   *
   * @param start - First line index of the block.
   * @param indent - Indentation the block's entries share.
   * @returns `{ value, next }` where `next` is the first unconsumed line index.
   */
  const readBlock = (start, indent) => {
    const first = nextSignificant(start)
    if (first === -1 || first >= end) return { value: null, next: start }
    const blockIndent = indent ?? depthOf(lines[first])
    const isSequence = /^\s*-\s/.test(lines[first]) || lines[first].trim() === '-'
    if (isSequence) {
      const items = []
      let cursor = first
      while (cursor < end) {
        const index = nextSignificant(cursor)
        if (index === -1 || index >= end) break
        const width = depthOf(lines[index])
        if (width < blockIndent) break
        if (width > blockIndent) {
          problems.push(
            problem(
              'ADR_FRONTMATTER_INVALID',
              'frontmatter line ' + (index + 1) + ' is indented deeper than the list it belongs to: ' + JSON.stringify(lines[index]),
            ),
          )
          cursor = index + 1
          continue
        }
        const itemMatch = /^\s*-\s?(.*)$/.exec(lines[index])
        if (itemMatch === null) break
        const rest = itemMatch[1].trim()
        if (rest.length === 0) {
          const child = readBlock(index + 1, null)
          items.push(child.value)
          cursor = child.next
          continue
        }
        const inlineKey = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(rest)
        if (inlineKey !== null && !rest.startsWith('"') && !rest.startsWith("'")) {
          // A sequence entry that OPENS a mapping: the remaining keys of that
          // mapping sit on the following lines, indented past the dash. The child
          // block discovers its own indent, and this first key is folded in.
          const child = readBlock(index + 1, null)
          const childValue = child.value
          const mapping =
            childValue !== null && typeof childValue === 'object' && !Array.isArray(childValue) ? childValue : {}
          const opened = inlineKey[2] === undefined || inlineKey[2].trim().length === 0 ? null : scalar(inlineKey[2])
          items.push({ [inlineKey[1]]: opened, ...mapping })
          cursor = Math.max(child.next, index + 1)
          continue
        }
        items.push(scalar(rest))
        cursor = index + 1
      }
      return { value: items, next: cursor }
    }

    const mapping = {}
    let cursor = first
    while (cursor < end) {
      const index = nextSignificant(cursor)
      if (index === -1 || index >= end) break
      const width = depthOf(lines[index])
      if (width < blockIndent) break
      if (width > blockIndent) {
        problems.push(
          problem(
            'ADR_FRONTMATTER_INVALID',
            'frontmatter line ' + (index + 1) + ' is indented deeper than the mapping it belongs to: ' + JSON.stringify(lines[index]),
          ),
        )
        cursor = index + 1
        continue
      }
      const pair = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(lines[index].trim())
      if (pair === null) {
        problems.push(
          problem(
            'ADR_FRONTMATTER_INVALID',
            'frontmatter line ' + (index + 1) + ' is not a "key: value" pair: ' + JSON.stringify(lines[index]),
          ),
        )
        cursor = index + 1
        continue
      }
      const key = pair[1]
      const inline = pair[2]
      if (inline !== undefined && inline.trim().length > 0) {
        mapping[key] = scalar(inline)
        cursor = index + 1
        continue
      }
      const child = readBlock(index + 1, null)
      mapping[key] = child.value
      // A key with no nested block at all (nothing indented follows) must not
      // swallow the next sibling key, so the cursor advances by one in that case.
      cursor = child.next > index ? child.next : index + 1
    }
    return { value: mapping, next: cursor }
  }
  const rootBlock = readBlock(1, 0)
  const data =
    rootBlock.value !== null && typeof rootBlock.value === 'object' && !Array.isArray(rootBlock.value)
      ? rootBlock.value
      : {}
  return { data, problems }
}

export function splitSections(source) {
  const sections = {}
  const lines = source.split('\n')
  // Skip past the frontmatter so a `##` inside it can never open a section.
  let start = 0
  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '---') {
        start = index + 1
        break
      }
    }
  }
  let current = null
  for (let index = start; index < lines.length; index += 1) {
    const heading = /^##\s+(.+?)\s*$/.exec(lines[index])
    if (heading !== null) {
      current = heading[1]
      sections[current] = []
      continue
    }
    if (current !== null) sections[current].push(lines[index])
  }
  const rendered = {}
  for (const [name, body] of Object.entries(sections)) rendered[name] = body.join('\n').trim()
  return { sections: rendered }
}

/**
 * Validates one ADR filename against `NNNN-slug.adr.md`.
 *
 * @param filename - Basename of the file.
 * @returns `{ ok, id }`; `id` is the four-digit prefix when the name is valid.
 */
export function parseAdrFilename(filename) {
  const match = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.adr\.md$/.exec(filename)
  if (match === null) return { ok: false, id: null }
  return { ok: true, id: match[1] }
}

/**
 * Validates a law's `checks` array.
 *
 * @param law - Parsed law mapping.
 * @param subject - ADR id the law belongs to, for the problem record.
 * @returns An array of problems; empty when every check is well formed.
 */
export function validateLawChecks(law, subject) {
  const problems = []
  const lawId = typeof law?.id === 'string' ? law.id : '(law with no id)'
  if (!Array.isArray(law?.checks)) {
    problems.push(
      problem('ADR_FIELD_INVALID', `law "${lawId}" declares no checks array`, subject, { lawId }),
    )
    return problems
  }
  for (const check of law.checks) {
    if (check === null || typeof check !== 'object') {
      problems.push(
        problem('ADR_FIELD_INVALID', `law "${lawId}" has a check that is not a mapping`, subject, {
          lawId,
        }),
      )
      continue
    }
    if (!oneOf(check.type, CHECK_TYPES)) {
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `law "${lawId}" uses check type ${JSON.stringify(check.type)}; supported types are ${CHECK_TYPES.join(', ')}`,
          subject,
          { lawId },
        ),
      )
      continue
    }
    const needsPath = ['required_file', 'forbidden_file']
    const needsPattern = ['required_glob', 'forbidden_glob']
    const needsPaths = ['required_text', 'forbidden_text', 'path_boundary']
    if (needsPath.includes(check.type) && typeof check.path !== 'string') {
      problems.push(
        problem('ADR_FIELD_INVALID', `law "${lawId}" check ${check.type} needs a "path"`, subject, {
          lawId,
        }),
      )
    }
    // A glob check needs a pattern that can match something. `globToRegExp('')` is
    // `/^$/`, which matches no repository path at all — so `forbidden_glob` with an
    // empty pattern found no offenders and reported the law satisfied while the file
    // it forbids sat in the tree. The text spellings already refuse an empty pattern;
    // the glob spellings are the same false pass one field over, and belong in the
    // same refusal rather than in the verifier that has to guess what was meant.
    if (needsPattern.includes(check.type) && (typeof check.pattern !== 'string' || check.pattern.length === 0)) {
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `law "${lawId}" check ${check.type} needs a non-empty "pattern": an empty glob matches no path, so a forbidden-glob check finds no offender and reports the law satisfied whatever the tree contains`,
          subject,
          { lawId },
        ),
      )
    }
    if (
      (needsPaths.includes(check.type) || check.type.endsWith('_dependency')) &&
      check.type !== 'path_boundary' &&
      !Array.isArray(check.paths) &&
      !Array.isArray(check.patterns)
    ) {
      const field = check.type.endsWith('_dependency') ? 'patterns' : 'paths'
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `law "${lawId}" check ${check.type} needs a "${field}" array`,
          subject,
          { lawId },
        ),
      )
    }
    // A text check over an EXPLICIT path list must name at least one path. An empty
    // list selects no file, and a `forbidden_text` law that searched nothing
    // reported itself satisfied — the same false pass the empty-pattern refusal
    // exists to prevent, one field over.
    if (
      (check.type === 'required_text' || check.type === 'forbidden_text') &&
      (!Array.isArray(check.paths) || check.paths.length === 0)
    ) {
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `law "${lawId}" check ${check.type} needs a non-empty "paths" array: with nothing to search the check cannot hold the law, and a forbidden-text check over no files reports itself satisfied`,
          subject,
          { lawId },
        ),
      )
    }
    // A dependency check reads `patterns` and NOTHING else. `paths` was accepted
    // here because this branch serves the text checks too, and a check written with
    // `paths` was then stored, compiled and evaluated as an EMPTY pattern list —
    // `required_dependency` reported itself satisfied over a manifest that did not
    // declare the dependency at all. Both the wrong field and the missing one are
    // refused, so the record cannot be written in the form that means nothing.
    if (check.type.endsWith('_dependency')) {
      if (!Array.isArray(check.patterns) || check.patterns.length === 0) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check ${check.type} needs a non-empty "patterns" array of dependency names; without it the check reads an empty list and can never fail`,
            subject,
            { lawId },
          ),
        )
      }
      if (check.paths !== undefined) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check ${check.type} declares "paths"; a dependency check reads "patterns", and a list of paths here would be stored and then ignored — which is a check that reports the law satisfied while checking nothing`,
            subject,
            { lawId },
          ),
        )
      }
    }
    if (check.type === 'path_boundary') {
      if (typeof check.zone !== 'string' || !Array.isArray(check.deny)) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check path_boundary needs a "zone" and a "deny" array`,
            subject,
            { lawId },
          ),
        )
      } else if (check.deny.length === 0) {
        // An empty deny restricts nothing and stops nothing: the check was accepted,
        // counted as evaluated, and passed over any tree — strictly less enforcement
        // than a deny that genuinely cannot overlap the zone, which is itself
        // reported. Refused where the decision is compiled rather than counted as a
        // check that held.
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check path_boundary declares no "deny" patterns, so it forbids the zone nothing and reports itself satisfied over any tree`,
            subject,
            { lawId },
          ),
        )
      } else {
        const badDeny = check.deny.filter(
          (entry) =>
            typeof entry !== 'string' ||
            entry.length === 0 ||
            entry.startsWith('/') ||
            entry.split(/[/\\]/).includes('..'),
        )
        if (badDeny.length > 0) {
          problems.push(
            problem(
              'ADR_FIELD_INVALID',
              `law "${lawId}" check path_boundary declares deny patterns that are not repository-relative globs: ${badDeny.map((entry) => JSON.stringify(entry)).join(', ')}`,
              subject,
              { lawId, deny: badDeny },
            ),
          )
        }
      }
    }
    // An absent or empty pattern is not a missing detail: `new RegExp(undefined)`
    // is the empty expression, which matches EVERY file — so a `required_text` law
    // with no pattern reported itself satisfied no matter what the code said. That
    // is a false pass, the one outcome a gate must never produce, and it is refused
    // where the decision is compiled rather than discovered by a reader trusting a
    // green run.
    if (
      (check.type === 'required_text' || check.type === 'forbidden_text') &&
      (typeof check.pattern !== 'string' || check.pattern.length === 0)
    ) {
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `law "${lawId}" check ${check.type} needs a non-empty "pattern": without one the check compiles to an empty regular expression, matches every file, and reports the law satisfied whatever the code says`,
          subject,
          { lawId },
        ),
      )
    }
    // Only where `pattern` IS a regular expression. For `required_glob` and its
    // siblings the same field is a GLOB, and a glob is not a valid regex —
    // `src/**/*.ts` fails to compile as one — so validating it here would reject
    // every correct glob law.
    if (REGEX_PATTERN_CHECK_TYPES.includes(check.type)) {
      if (
        check.flags !== undefined &&
        (typeof check.flags !== 'string' || !/^[imsud]*$/.test(check.flags))
      ) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check ${check.type} declares flags ${JSON.stringify(check.flags)}; expected a string of ${REGEX_FLAGS.join('/')} flags. The stateful flags g and y are refused deliberately: test() and exec() advance lastIndex on them, so one matcher reused across files skips matches depending on file ORDER, and a law that holds for the tree failed for one`,
            subject,
            { lawId },
          ),
        )
      }
      if (typeof check.pattern === 'string' && check.pattern.length > 0) {
        // Compiled here so an unusable pattern is a problem with the DECISION,
        // reported by every compile on every machine, instead of an exception thrown
        // in the middle of one verification.
        try {
          new RegExp(check.pattern, typeof check.flags === 'string' ? check.flags : '')
        } catch (error) {
          problems.push(
            problem(
              'ADR_FIELD_INVALID',
              `law "${lawId}" check ${check.type} declares pattern ${JSON.stringify(check.pattern)}, which is not a usable regular expression: ${String(error)}`,
              subject,
              { lawId },
            ),
          )
        }
      }
    }
    if (check.type.endsWith('_text_glob')) {
      if (!Array.isArray(check.paths) || check.paths.length === 0) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check ${check.type} needs a non-empty "paths" array of globs`,
            subject,
            { lawId },
          ),
        )
      }
      // An empty pattern is not a missing detail here either: it compiles to the
      // empty expression, which matches every file, so a `required_text_glob` law
      // with `pattern: ""` verified clean over code that shared no text at all.
      if (typeof check.pattern !== 'string' || check.pattern.length === 0) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check ${check.type} needs a non-empty "pattern": an empty one compiles to a regular expression that matches every file, so the check asserts nothing while reporting itself satisfied`,
            subject,
            { lawId },
          ),
        )
      }
    }
    if (check.type === 'required_file_in_list') {
      for (const field of ['path', 'list', 'contains']) {
        if (typeof check[field] !== 'string') {
          problems.push(
            problem(
              'ADR_FIELD_INVALID',
              `law "${lawId}" check required_file_in_list needs a "${field}" string`,
              subject,
              { lawId },
            ),
          )
        }
      }
    }
    if (check.type === 'command') {
      if (typeof check.run !== 'string' || check.run.trim().length === 0) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check command needs a "run" string`,
            subject,
            { lawId },
          ),
        )
      }
      // A command check is the one that can damage the project, so the fields that
      // make runaway costs impossible are validated rather than defaulted silently.
      if (check.timeoutMs !== undefined && (typeof check.timeoutMs !== 'number' || check.timeoutMs <= 0)) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check command declares timeoutMs ${JSON.stringify(check.timeoutMs)}; expected a positive number of milliseconds`,
            subject,
            { lawId },
          ),
        )
      }
      for (const field of ['outputContains', 'outputNotContains']) {
        if (check[field] !== undefined && (typeof check[field] !== 'string' || check[field].length === 0)) {
          problems.push(
            problem(
              'ADR_FIELD_INVALID',
              `law "${lawId}" check command declares ${field} ${JSON.stringify(check[field])}; expected a non-empty string, because an empty assertion matches every output and therefore asserts nothing`,
              subject,
              { lawId },
            ),
          )
        }
      }
      if (check.outputMatches !== undefined) {
        if (typeof check.outputMatches !== 'string' || check.outputMatches.length === 0) {
          problems.push(
            problem(
              'ADR_FIELD_INVALID',
              `law "${lawId}" check command declares outputMatches ${JSON.stringify(check.outputMatches)}; expected a non-empty regular expression`,
              subject,
              { lawId },
            ),
          )
        } else {
          // Compiled here rather than at the check, so a malformed pattern is a
          // problem with the DECISION — reported by every compile, everywhere —
          // instead of an exception thrown mid-verification on one machine.
          try {
            new RegExp(check.outputMatches)
          } catch (error) {
            problems.push(
              problem(
                'ADR_FIELD_INVALID',
                `law "${lawId}" check command declares outputMatches ${JSON.stringify(check.outputMatches)}, which is not a usable regular expression: ${String(error)}`,
                subject,
                { lawId },
              ),
            )
          }
        }
      }
      if (check.stream !== undefined && !oneOf(check.stream, COMMAND_STREAMS)) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${lawId}" check command declares stream ${JSON.stringify(check.stream)}; expected one of ${COMMAND_STREAMS.join(', ')}`,
            subject,
            { lawId },
          ),
        )
      }
    }
  }
  return problems
}

/**
 * Validates every check referenced by an ADR's laws.
 *
 * @param laws - The ADR's parsed `laws` array.
 * @param subject - ADR id, for the problem record.
 * @returns An array of problems; empty when every law is well formed.
 */
export function validateLaws(laws, subject) {
  const problems = []
  if (!Array.isArray(laws)) {
    return [problem('ADR_FIELD_INVALID', 'the laws field is not a list', subject)]
  }
  const seen = new Set()
  for (const law of laws) {
    if (law === null || typeof law !== 'object') {
      problems.push(problem('ADR_FIELD_INVALID', 'a law entry is not a mapping', subject))
      continue
    }
    if (typeof law.id !== 'string' || law.id.length === 0) {
      problems.push(problem('ADR_FIELD_INVALID', 'a law declares no id', subject))
      continue
    }
    if (seen.has(law.id)) {
      problems.push(problem('LAW_DUPLICATE', `law id "${law.id}" appears twice in this ADR`, subject, { lawId: law.id }))
    }
    seen.add(law.id)
    if (!oneOf(law.op, ['upsert', 'remove'])) {
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `law "${law.id}" declares op ${JSON.stringify(law.op)}; expected "upsert" or "remove"`,
          subject,
          { lawId: law.id },
        ),
      )
    }
    if (law.op === 'upsert') {
      if (typeof law.statement !== 'string' || law.statement.trim().length === 0) {
        problems.push(
          problem('ADR_FIELD_INVALID', `law "${law.id}" is an upsert with no statement`, subject, {
            lawId: law.id,
          }),
        )
      }
      // Why the law is not fully enforced, when it is not. Required to be a real
      // sentence rather than a flag: "this one cannot be machine-checked" is a claim
      // a reader has to be able to evaluate, and `unenforced: true` would be an
      // exemption with no reason attached — which is what silence already was. The
      // length floor is what stops `unenforced: "0"` from being an exemption too.
      if (law.unenforced !== undefined && (typeof law.unenforced !== 'string' || law.unenforced.trim().length < MIN_UNENFORCED_LENGTH)) {
        problems.push(
          problem(
            'ADR_FIELD_INVALID',
            `law "${law.id}" declares unenforced ${JSON.stringify(law.unenforced)}; expected at least ${MIN_UNENFORCED_LENGTH} characters saying what cannot be checked and why, or no field at all`,
            subject,
            { lawId: law.id },
          ),
        )
      }
      problems.push(...validateLawChecks(law, subject))
    }
  }
  return problems
}

/**
 * Reads and validates the `ratification` block of an approval ADR.
 *
 * An approval ADR is the artifact that puts another decision into force, so the
 * question it has to answer is not "who wrote this file" — a file cannot know that
 * — but "what exactly did a human consent to, and by what channel". The block
 * records the channel, the moment, who asked, and a content hash per approved
 * record; the hash is what makes the consent cover a *text* rather than a title,
 * so an edit after the fact is detectable instead of invisible.
 *
 * The block is required on every approval ADR. An approval without one is not a
 * weaker approval, it is an unproven claim, and it confers nothing: the compiler
 * reads `null` here and refuses to activate anything through it.
 *
 * @param data - Parsed frontmatter mapping.
 * @param context - `{ path, id, type }` used to label problems.
 * @returns `{ value, problems }`. `value` is
 *   `{ channel, at, askedBy, targets: [{ id, contentHash }] }` when the block is
 *   present and well formed, and `null` in every other case — absent on a
 *   non-approval record, absent on an approval record, or present but malformed.
 *   Every `null` that is a defect also pushes a problem.
 */
export function readRatification(data, { path, id, type }) {
  const problems = []
  const raw = data?.ratification
  if (raw === undefined || raw === null) {
    if (type === 'approval') {
      problems.push(
        problem(
          'RATIFICATION_UNPROVEN',
          `${path} is an approval ADR but records no ratification block, so nothing shows that a human saw the text it approves or that they consented to that text; ratify through the ratchet so the record carries the channel, the time and a hash of each approved record`,
          id,
          { path },
        ),
      )
    }
    return { value: null, problems }
  }
  if (type !== 'approval') {
    problems.push(
      problem(
        'ADR_FIELD_INVALID',
        `${path} declares a ratification block on a "${String(type)}" record; only an approval ADR records consent, and a decision that carries one is claiming an approval it cannot have`,
        id,
        { path },
      ),
    )
    return { value: null, problems }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(
      problem('ADR_FIELD_INVALID', `${path} declares a ratification block that is not a mapping`, id, { path }),
    )
    return { value: null, problems }
  }

  const fail = (message) => {
    problems.push(problem('ADR_FIELD_INVALID', `${path} ${message}`, id, { path }))
    return { value: null, problems }
  }

  if (!oneOf(raw.channel, RATIFICATION_CHANNELS)) {
    return fail(
      `records ratification.channel ${JSON.stringify(raw.channel)}; expected one of ${RATIFICATION_CHANNELS.join(', ')}`,
    )
  }
  if (typeof raw.at !== 'string' || raw.at.trim().length === 0) {
    return fail('records a ratification with no "at" timestamp')
  }
  if (typeof raw.askedBy !== 'string' || raw.askedBy.trim().length === 0) {
    return fail(
      'records a ratification with no "askedBy"; a consent nobody can be asked about is a consent nobody gave',
    )
  }
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    return fail('records a ratification with no "targets" array, so it names no record it approved')
  }

  const targets = []
  const seen = new Set()
  for (const entry of raw.targets) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return fail('has a ratification target that is not a mapping')
    }
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      return fail('has a ratification target with no id')
    }
    if (seen.has(entry.id)) {
      return fail(`names "${entry.id}" twice in its ratification targets`)
    }
    seen.add(entry.id)
    if (typeof entry.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(entry.contentHash)) {
      return fail(
        `records contentHash ${JSON.stringify(entry.contentHash)} for "${entry.id}"; expected sha256:<64 hex characters>, which is what binds the consent to the exact text that was approved`,
      )
    }
    targets.push({ id: entry.id, contentHash: entry.contentHash })
  }

  // An approval that lists targets but names no decision in `approves` puts
  // nothing into force, and reads like a completed approval. The mismatch is
  // reported here because both halves live in this file.
  const approves = Array.isArray(data.approves) ? data.approves.map((entry) => String(entry)) : []
  const missing = approves.filter((approved) => !targets.some((target) => target.id === approved))
  if (missing.length > 0) {
    problems.push(
      problem(
        'RATIFICATION_UNPROVEN',
        `${path} approves ${missing.map((entry) => `"${entry}"`).join(', ')} but records no ratification target for ${missing.length === 1 ? 'it' : 'them'}, so the consent does not cover ${missing.length === 1 ? 'that decision' : 'those decisions'}`,
        id,
        { path, missing },
      ),
    )
  }

  return {
    value: { channel: raw.channel, at: raw.at.trim(), askedBy: raw.askedBy.trim(), targets },
    problems,
  }
}

/**
 * Parses one ADR file into a record.
 *
 * Identity comes from the frontmatter, and the filename must agree with it. A
 * file that parses but breaks a rule returns **both** a record and the problems,
 * so the compiler can still reason about the corpus while the verifier fails the
 * gate — the two must not disagree about what exists.
 *
 * @param options - `{ filename, source, root, decisionsDir }`. `root` is the
 *   absolute project root, used to resolve the declared source path; pass `null`
 *   to skip the source-existence and hash checks (used by tests that exercise
 *   parsing alone). `decisionsDir` is the manifest-declared directory, used only
 *   to label the problem records, so no path is hardcoded here.
 * @returns `{ record, problems }`. `record` is `null` when the file declares no
 *   id at all and therefore cannot be identified.
 */
export function parseAdr({ filename, source, root = null, decisionsDir = RATCHET_DIR_DEFAULT }) {
  const problems = []
  const text = normaliseText(source)
  const path = `${decisionsDir}/${filename}`

  const nameCheck = parseAdrFilename(filename)
  if (!nameCheck.ok) {
    problems.push(
      problem(
        'ADR_FILE_INVALID',
        `${path} does not match NNNN-slug.adr.md (four digits, a lowercase hyphenated slug, and the .adr.md suffix)`,
        null,
        { path },
      ),
    )
  }

  const { data, problems: frontmatterProblems } = parseFrontmatter(text)
  for (const entry of frontmatterProblems) {
    problems.push({ ...entry, subject: entry.subject ?? filename, path })
  }
  if (data === null) {
    problems.push(
      problem(
        'ADR_FRONTMATTER_MISSING',
        `${path} has no YAML frontmatter block; an ADR must open with --- and declare id, title, type, status, author, source, zones and laws`,
        filename,
        { path },
      ),
    )
    return { record: null, problems }
  }

  const { sections } = splitSections(text)

  for (const field of MANDATORY_ADR_FIELDS) {
    const value = data[field]
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0 && field !== 'laws' && field !== 'zones')
    if (empty) {
      problems.push(
        problem('ADR_FIELD_MISSING', `${path} declares no ${field}`, String(data.id ?? filename), {
          path,
          field,
        }),
      )
    }
  }

  const id = typeof data.id === 'string' ? data.id : null
  if (id !== null) {
    if (!/^\d{4}$/.test(id)) {
      problems.push(
        problem('ADR_FIELD_INVALID', `${path} declares id ${JSON.stringify(id)}; expected four digits`, id, {
          path,
        }),
      )
    }
    if (nameCheck.ok && nameCheck.id !== id) {
      problems.push(
        problem(
          'ADR_ID_MISMATCH',
          `${path} declares id "${id}" but its filename prefix is "${nameCheck.id}"`,
          id,
          { path },
        ),
      )
    }
  }
  if (id === null) {
    return { record: null, problems }
  }

  if (!oneOf(data.type, ADR_TYPES)) {
    problems.push(
      problem(
        'ADR_FIELD_INVALID',
        `${path} declares type ${JSON.stringify(data.type)}; expected one of ${ADR_TYPES.join(', ')}`,
        id,
        { path },
      ),
    )
  }
  if (!oneOf(data.status, ADR_STATUSES)) {
    problems.push(
      problem(
        'ADR_FIELD_INVALID',
        `${path} declares status ${JSON.stringify(data.status)}; expected one of ${ADR_STATUSES.join(', ')}`,
        id,
        { path },
      ),
    )
  }

  const author = data.author !== null && typeof data.author === 'object' ? data.author : {}
  if (!oneOf(author.authority, AUTHORITIES)) {
    problems.push(
      problem(
        'ADR_FIELD_INVALID',
        `${path} declares author.authority ${JSON.stringify(author.authority)}; expected one of ${AUTHORITIES.join(', ')}`,
        id,
        { path },
      ),
    )
  }

  const sourceField = data.source !== null && typeof data.source === 'object' ? data.source : {}
  const sourceKind = typeof sourceField.kind === 'string' ? sourceField.kind : 'file'
  const sourcePath = typeof sourceField.path === 'string' ? sourceField.path : null
  const sourceHash = typeof sourceField.hash === 'string' ? sourceField.hash : null
  if (sourceHash !== null && !/^sha256:[0-9a-f]{64}$/.test(sourceHash)) {
    problems.push(
      problem(
        'ADR_SOURCE_HASH_FORM',
        `${path} records source.hash ${JSON.stringify(sourceHash)}; expected sha256:<64 hex characters>`,
        id,
        { path },
      ),
    )
  }

  for (const section of ADR_SECTIONS) {
    if (sections[section] === undefined) {
      problems.push(
        problem(
          'ADR_SECTION_MISSING',
          `${path} has no "## ${section}" section; the ADR body must carry ${ADR_SECTIONS.map((name) => `## ${name}`).join(', ')}`,
          id,
          { path, section },
        ),
      )
    }
  }
  if (sections.Reasoning !== undefined && sections.Reasoning.trim().length === 0) {
    problems.push(
      problem(
        'ADR_MISSING_REASONING',
        `${path} has an empty "## Reasoning" section; a decision with no reasoning is not a decision record`,
        id,
        { path },
      ),
    )
  }

  const zones = Array.isArray(data.zones) ? data.zones.map((zone) => String(zone)) : []
  const laws = Array.isArray(data.laws) ? data.laws : []
  problems.push(...validateLaws(laws, id))

  const supersedes = Array.isArray(data.supersedes) ? data.supersedes.map((entry) => String(entry)) : []
  const approves = Array.isArray(data.approves) ? data.approves.map((entry) => String(entry)) : []
  if (supersedes.includes(id)) {
    problems.push(problem('ADR_SUPERSEDES_SELF', `${path} supersedes itself`, id, { path }))
  }
  if (data.type === 'approval' && approves.length === 0) {
    problems.push(
      problem(
        'ADR_FIELD_MISSING',
        `${path} is an approval ADR whose approves list is empty, so it puts no decision into force while reading like a completed approval`,
        id,
        { path, field: 'approves' },
      ),
    )
  }
  const ratification = readRatification(data, { path, id, type: data.type })
  problems.push(...ratification.problems)

  // Source verification: "no decision without reasoning" is only a rule where
  // something fails when the reasoning is gone. The source file is read and
  // hashed here, and the three failure modes stay distinct — a missing file, an
  // unreadable file, and a hash that no longer matches are different situations
  // needing different fixes.
  let sourceStatus = 'unchecked'
  let sourceActualHash = null
  if (root !== null && sourcePath !== null) {
    if (sourceKind !== 'file') {
      // A non-file source is a deliberate future extension point. It is reported
      // as unchecked rather than failed, because failing a record for using a
      // source kind the ratchet has not implemented would be a false alarm.
      sourceStatus = 'unsupported-kind'
    } else {
      const absolute = join(root, sourcePath)
      if (!existsSync(absolute)) {
        sourceStatus = 'missing'
        problems.push(
          problem(
            'ADR_SOURCE_MISSING',
            `${path} declares its reasoning source at ${sourcePath}, which does not exist; an ADR must trace to the reasoning that produced it`,
            id,
            { path, sourcePath },
          ),
        )
      } else {
        let sourceText
        try {
          sourceText = readFileSync(absolute, 'utf8')
        } catch (error) {
          sourceStatus = 'unreadable'
          problems.push(
            problem(
              'ADR_SOURCE_MISSING',
              `${path} declares its reasoning source at ${sourcePath}, which exists but could not be read: ${String(error)}`,
              id,
              { path, sourcePath },
            ),
          )
        }
        if (sourceText !== undefined) {
          sourceActualHash = hashSource(sourceText)
          if (sourceHash === null) {
            // A record may omit the hash, and then the source is unverified but
            // not wrong. The actual hash is reported so the record can be fixed
            // by copying one value rather than by working out how to compute it.
            sourceStatus = 'unhashed'
          } else if (sourceHash !== sourceActualHash) {
            sourceStatus = 'mismatch'
            problems.push(
              problem(
                'ADR_SOURCE_HASH_MISMATCH',
                `${path} records source.hash ${sourceHash} for ${sourcePath}, but the file now hashes to ${sourceActualHash}; either the reasoning was edited after the decision was taken, or the hash was never updated`,
                id,
                { path, sourcePath, recorded: sourceHash, actual: sourceActualHash },
              ),
            )
          } else {
            sourceStatus = 'verified'
          }
        }
      }
    }
  }

  return {
    record: {
      id,
      path,
      filename,
      title: typeof data.title === 'string' ? data.title : null,
      type: typeof data.type === 'string' ? data.type : null,
      status: typeof data.status === 'string' ? data.status : null,
      authority: typeof author.authority === 'string' ? author.authority : null,
      authorName: typeof author.name === 'string' ? author.name : null,
      created: typeof data.created === 'string' ? data.created : null,
      zones,
      laws,
      supersedes,
      approves,
      // The record's own hash, over the same normalised text every other hash in
      // this module uses. A ratification stores the hash it approved, so the
      // compiler can tell "this is the text the human consented to" from "this is
      // that text after somebody edited it" — which is the whole difference
      // between a consent and an alibi.
      contentHash: hashSource(text),
      ratification: ratification.value,
      source: {
        kind: sourceKind,
        path: sourcePath,
        hash: sourceHash,
        status: sourceStatus,
        actualHash: sourceActualHash,
      },
      sections,
      filenameId: nameCheck.id,
      filenameValid: nameCheck.ok,
    },
    problems,
  }
}

/**
 * Computes the sha256 of a string in the exact form an ADR records.
 *
 * The digest is taken over the NORMALISED text, so a checkout that rewrites
 * line endings cannot invalidate every decision in a repository at once.
 *
 * @param text - Raw source text.
 * @returns `sha256:<64 lowercase hex characters>`.
 */
export function hashSource(text) {
  return `sha256:${createHash('sha256').update(normaliseText(text), 'utf8').digest('hex')}`
}

/**
 * Reads and validates the ratchet section of a project manifest.
 *
 * @param manifestText - Raw `.dsh/project.json` contents.
 * @param manifestHash - Hash of that text, recorded in reports.
 * @returns `{ config, problems }`; `config` is `null` when the manifest cannot be
 *   used at all. When the manifest parses but declares no ratchet section, a
 *   default configuration is returned with `enabled: false`, because "not
 *   configured" and "configured but broken" need different messages.
 */
export function parseRatchetConfig(manifestText, manifestHash = null) {
  const problems = []
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch (error) {
    return {
      config: null,
      problems: [
        problem('MANIFEST_INVALID', `${MANIFEST_PATH} is not valid JSON: ${String(error)}`),
      ],
    }
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      config: null,
      problems: [
        problem('MANIFEST_INVALID', `${MANIFEST_PATH} is not a JSON object`),
      ],
    }
  }

  const ratchet = manifest.ratchet
  const defaults = {
    enabled: false,
    project: typeof manifest.name === 'string' ? manifest.name : null,
    decisionsDir: RATCHET_DIR_DEFAULT,
    sourcesDir: 'docs/ratchet/sources',
    specsDir: 'docs/specs',
    reportsDir: 'reports/ratchet',
    stateDir: '.dsh/ratchet',
    defaultAgentAuthority: DEFAULT_AGENT_AUTHORITY,
    zones: [],
    manifestHash,
  }

  if (ratchet === undefined || ratchet === null) {
    return { config: defaults, problems }
  }
  if (typeof ratchet !== 'object' || Array.isArray(ratchet)) {
    return {
      config: null,
      problems: [
        problem(
          'MANIFEST_INVALID',
          `${MANIFEST_PATH} declares a ratchet section that is not an object`,
        ),
      ],
    }
  }

  const config = { ...defaults, enabled: ratchet.enabled === true }

  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    problems.push(
      problem(
        'MANIFEST_INVALID',
        `${MANIFEST_PATH} declares no "name"; every ratchet report names its project, and a missing name is reported rather than rendered as null`,
      ),
    )
  }

  for (const field of ['decisionsDir', 'sourcesDir', 'specsDir', 'reportsDir', 'stateDir']) {
    if (ratchet[field] === undefined) continue
    if (typeof ratchet[field] !== 'string' || ratchet[field].trim().length === 0) {
      problems.push(
        problem('MANIFEST_INVALID', `${MANIFEST_PATH} declares ratchet.${field} that is not a non-empty string`),
      )
      continue
    }
    config[field] = ratchet[field].trim().replace(/\/+$/, '')
  }

  if (ratchet.defaultAgentAuthority !== undefined) {
    if (!oneOf(ratchet.defaultAgentAuthority, AGENT_AUTHORITY_POLICIES)) {
      problems.push(
        problem(
          'MANIFEST_INVALID',
          `${MANIFEST_PATH} declares ratchet.defaultAgentAuthority ${JSON.stringify(ratchet.defaultAgentAuthority)}; expected one of ${AGENT_AUTHORITY_POLICIES.join(', ')}`,
        ),
      )
    } else {
      config.defaultAgentAuthority = ratchet.defaultAgentAuthority
    }
  }

  // Whether generated spec documents are tracked. Left `undefined` when unset, so
  // the reader can apply its own default (track them once any exists) rather than
  // this parser deciding policy for every caller.
  if (ratchet.specsRequired !== undefined) {
    if (typeof ratchet.specsRequired !== 'boolean') {
      problems.push(
        problem(
          'MANIFEST_INVALID',
          `${MANIFEST_PATH} declares ratchet.specsRequired that is not a boolean`,
        ),
      )
    } else {
      config.specsRequired = ratchet.specsRequired
    }
  }

  if (ratchet.zones !== undefined) {
    if (!Array.isArray(ratchet.zones)) {
      problems.push(problem('MANIFEST_INVALID', `${MANIFEST_PATH} declares ratchet.zones that is not an array`))
    } else {
      const seen = new Set()
      config.zones = []
      for (const [index, zone] of ratchet.zones.entries()) {
        const zoneId = zone !== null && typeof zone === 'object' ? zone.id : undefined
        if (typeof zoneId !== 'string' || zoneId.trim().length === 0) {
          problems.push(
            problem('ZONE_INVALID', `ratchet.zones[${index}] declares no id`, null, { index }),
          )
          continue
        }
        if (seen.has(zoneId)) {
          problems.push(problem('ZONE_INVALID', `two zones share the id "${zoneId}"`, zoneId))
          continue
        }
        seen.add(zoneId)
        if (!Array.isArray(zone.paths) || zone.paths.length === 0) {
          problems.push(
            problem(
              'ZONE_INVALID',
              `zone "${zoneId}" declares no paths; a zone with no paths binds no code`,
              zoneId,
            ),
          )
          continue
        }
        const badPaths = zone.paths.filter(
          (entry) => typeof entry !== 'string' || entry.trim().length === 0 || entry.startsWith('/') || entry.includes('..'),
        )
        if (badPaths.length > 0) {
          problems.push(
            problem(
              'ZONE_PATH_INVALID',
              `zone "${zoneId}" declares paths that are not repository-relative patterns: ${badPaths.map((entry) => JSON.stringify(entry)).join(', ')}`,
              zoneId,
            ),
          )
          continue
        }
        if (zone.agentAuthority !== undefined && !oneOf(zone.agentAuthority, AGENT_AUTHORITY_POLICIES)) {
          problems.push(
            problem(
              'ZONE_INVALID',
              `zone "${zoneId}" declares agentAuthority ${JSON.stringify(zone.agentAuthority)}; expected one of ${AGENT_AUTHORITY_POLICIES.join(', ')}`,
              zoneId,
            ),
          )
          continue
        }
        config.zones.push({
          id: zoneId,
          paths: zone.paths.map((entry) => entry.trim()),
          agentAuthority: zone.agentAuthority ?? config.defaultAgentAuthority,
          requiresDecisionRecord: zone.requiresDecisionRecord === true,
        })
      }
    }
  }

  return { config, problems }
}

/**
 * Decides which zone a repository path belongs to.
 *
 * Longest matching glob wins, so a narrow zone nested inside a broad one takes
 * precedence deterministically instead of depending on declaration order. A path
 * matching no zone belongs to no zone, which callers must treat as "unregulated"
 * rather than "allowed".
 *
 * @param path - Repository-relative path with forward slashes.
 * @param zones - Parsed zone list.
 * @returns The matching zone, or `null`.
 */
export function zoneFor(path, zones) {
  let best = null
  let bestLength = -1
  for (const zone of zones ?? []) {
    for (const glob of zone.paths) {
      const prefix = glob.replace(/\/\*\*$/, '').replace(/\/\*$/, '')
      const isPrefixMatch = path === prefix || path.startsWith(`${prefix}/`)
      const isExact = !glob.includes('*') && path === glob
      if (!isPrefixMatch && !isExact) continue
      if (prefix.length > bestLength) {
        best = zone
        bestLength = prefix.length
      }
    }
  }
  return best
}
