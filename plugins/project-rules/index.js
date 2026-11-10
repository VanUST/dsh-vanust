/**
 * PURPOSE
 *   One workspace-local rules file (`.dsh/rules.md`) that becomes ONE system-prompt
 *   section for every agent and subagent, plus a `/project-rules` command the Web panel
 *   edits it through. The section is frozen per turn and the previous string is KEPT when
 *   the file's bytes did not change, so typing in the panel cannot invalidate a cached
 *   prompt prefix and an unchanged file cannot churn the system prompt between turns.
 *
 * WHY THE FREEZE IS THE FEATURE. A prompt section whose text is rebuilt from live state
 *   makes the provider re-bill the whole conversation from the first changed byte. The
 *   measured failure on this deployment (2026-11-09, session df8c3329) was 19 of 20 steps
 *   carrying a system re-render with only 1,792 cached tokens. The rules file is edited by
 *   a human who types; if the section read the file per assembly, every keystroke followed
 *   by a step would be a full-context miss. So: the editor writes only on Save, the save
 *   only writes the file, and the section re-reads at `turn/start` - never mid-turn.
 *
 * INPUTS
 *   Config (all optional):
 *     file      rules path relative to the session workspace. Default `.dsh/rules.md`.
 *     maxBytes  hard cap. Default 32768 (32 KB).
 *
 * OUTPUTS
 *   A prompt section named `project:rules` at order 12 on every agent (root and child),
 *   empty when the file is empty; and `/project-rules` (JSON `{op:"read"}` or
 *   `{op:"save", text}`) for the panel. Save returns `{ok, bytes}`.
 *
 *   THE FILE IS THE HUMAN'S. Every agent READS it through the prompt section and none may
 *   change it: a `tools/pre-execute` guard refuses `write`/`edit` on the resolved rules
 *   path and a shell command that names it, both with the code `rules_human_only`. The
 *   command the panel uses is a different registry, so the human's Save is untouched. This
 *   is a guardrail, not a jail: a shell command can spell a path a hundred ways, and a
 *   guard that inspects strings cannot follow all of them. The guard makes the boundary
 *   explicit and catches the ordinary attempt; the human's review is what makes it true.
 *
 * KEYWORDS
 *   project rules, prompt section, cache, freezePerTurn, turn boundary, rules editor
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Missing file: empty rules, no section.
 *   - Empty file: empty rules, no section (the prompt renderer drops empty sections).
 *   - Invalid UTF-8: the read/save refuses instead of writing replacement characters.
 *   - Over maxBytes: refused with the byte count; the file is not truncated.
 *   - A save never mutates the in-memory section: the next turn's freeze is the only
 *     path from the file to the prompt.
 *   - Bytes unchanged at a turn boundary: the previous JS string is kept, not replaced
 *     with an equal copy, so the section cannot churn on re-read.
 *   - Writes are temp-file + rename, so a crash cannot leave half a rules file.
 *   - A child agent reads the same workspace file; there is no depth check and no
 *     per-role variant, because reading is not owning.
 *   - The write/edit guard compares RESOLVED paths, so `./.dsh/rules.md`,
 *     `.dsh/../.dsh/rules.md` and an absolute path are the same file. A symlink or a
 *     hardlink to it is not followed: that is the guardrail's stated limit.
 *   - The shell guard refuses any `bash`/`pwsh` command that names the rules path or the
 *     `.dsh/rules` prefix. A READ through the shell is refused too, because a command is
 *     not parsed and a read and a write look the same to a substring match; the rules
 *     reach every agent through the prompt section, so nothing is lost.
 *   - Nothing else is inspected: any other tool, path or command passes through to the
 *     next listener unchanged.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Cordis function-plugin name; also the id the profile patch targets. */
export const name = 'project-rules'

/** The command registry is required; `tools` is the pre-execute seam the guard listens on. */
export const inject = ['commands', 'tools']

/** Section placement: before the task/role sections, after the harness's own rules. */
const SECTION_NAME = 'project:rules'
const SECTION_ORDER = 12
const DEFAULT_MAX_BYTES = 32 * 1024

/** The refusal code a model can quote; also the first word of the reason it gets back. */
export const RULES_HUMAN_ONLY = 'rules_human_only'

/** What the model is told when it reaches for the human's file. */
export const RULES_DENY_REASON = `${RULES_HUMAN_ONLY}: .dsh/rules.md is the human's file. You read it through the project:rules prompt section and must not change it - ask the human to edit it in the Rules panel, then work to the rules you were given.`

/** Resolve the session workspace, falling back to the process directory. */
function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

function rulesPath(config, cwd) {
  const file = typeof config.file === 'string' && config.file !== '' ? config.file : '.dsh/rules.md'
  return isAbsolute(file) ? file : resolve(cwd, file)
}

/**
 * Read the rules file as text, refusing invalid UTF-8 and oversize files.
 *
 * @param path - absolute rules path.
 * @param maxBytes - hard cap in bytes.
 * @returns `{ text, bytes }`; a missing file is `{ text: '', bytes: 0 }`.
 */
function readRules(path, maxBytes) {
  if (!existsSync(path)) return { text: '', bytes: 0 }
  const buffer = readFileSync(path)
  if (buffer.byteLength > maxBytes) {
    throw new Error(`project-rules: ${path} is ${buffer.byteLength} bytes; the limit is ${maxBytes}`)
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error(`project-rules: ${path} is not valid UTF-8; refusing to reinterpret it`)
  }
  return { text, bytes: buffer.byteLength }
}

/**
 * Per-agent section state: the frozen text plus the bytes it came from.
 *
 * `refresh` is called only at turn/start. When the file bytes equal the bytes behind the
 * current string, the string is left in place - a fresh equal string would be harmless to
 * a content hash but this states the contract the brief asks for, and keeps the section
 * object stable for any consumer that compares identity.
 */
function createRulesState(config) {
  const maxBytes = Number.isSafeInteger(config.maxBytes) && config.maxBytes > 0 ? config.maxBytes : DEFAULT_MAX_BYTES
  let text = null
  let bytes = null
  return {
    /** The frozen text for this turn, read once after the last refresh. */
    text(cwd) {
      if (text === null) {
        const rules = readRules(rulesPath(config, cwd), maxBytes)
        text = rules.text
        bytes = rules.bytes
      }
      return text
    },
    /** Turn boundary: re-read, but keep the old string when the bytes are identical. */
    refresh(cwd) {
      if (text === null) return
      let rules
      try {
        rules = readRules(rulesPath(config, cwd), maxBytes)
      } catch {
        // A file that became unreadable must not take the turn down; the last good
        // rules stay in force until it is fixed and a later turn re-reads it.
        return
      }
      if (bytes !== null && rules.bytes === bytes && rules.text === text) return
      text = rules.text
      bytes = rules.bytes
    },
  }
}

/**
 * Whether two absolute paths name the same file for the purpose of this guard.
 *
 * Comparison is textual after `resolve`, plus the separator/case normalisation a Windows
 * path needs. A symlink is deliberately NOT resolved: the guard is a guardrail, and
 * claiming to follow links would overstate it.
 *
 * @param left - Resolved path from the tool call.
 * @param right - Resolved rules path.
 * @returns Whether they are the same path.
 */
export function samePath(left, right) {
  const normalize = (value) => {
    const slashed = String(value).replaceAll('\\', '/')
    return process.platform === 'win32' ? slashed.toLowerCase() : slashed
  }
  return normalize(left) === normalize(right)
}

/**
 * Whether a shell command names the rules file.
 *
 * A command is a string, not a filesystem operation, so this is a substring test over the
 * absolute path, the workspace-relative path and the `.dsh/rules` prefix. It cannot see a
 * path that was built by a variable or split across arguments - that limit is stated in
 * the README, the docs and this file's refusal text.
 *
 * @param command - The shell command the agent asked to run.
 * @param cwd - The agent's workspace.
 * @param target - The resolved rules path.
 * @returns Whether the guard should refuse it.
 */
export function commandNamesRules(command, cwd, target) {
  if (typeof command !== 'string' || command === '') return false
  const haystack = command.replaceAll('\\', '/').toLowerCase()
  const absoluteForm = target.replaceAll('\\', '/').toLowerCase()
  const relativeForm = relative(cwd, target).replaceAll('\\', '/').toLowerCase()
  const needles = new Set([absoluteForm, relativeForm])
  // `.dsh/rules` is the path with the file name stripped, so `.dsh/rules.md`, `.dsh/rules`
  // and a sibling such as `.dsh/rules.bak` all count as the same boundary.
  const stem = relativeForm.replace(/\.[^./]*$/, '')
  if (stem !== '' && stem !== relativeForm) needles.add(stem)
  return [...needles].some((needle) => needle !== '' && haystack.includes(needle))
}

/** Atomic write of exactly the text the human typed. */
function writeRules(path, text, maxBytes) {
  if (typeof text !== 'string') throw new Error('project-rules: save needs a text string')
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) throw new Error(`project-rules: ${bytes} bytes exceeds the ${maxBytes}-byte limit`)
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, text, 'utf8')
  chmodSync(temp, 0o644)
  renameSync(temp, path)
  return bytes
}

export function apply(ctx, config = {}) {
  const maxBytes = Number.isSafeInteger(config.maxBytes) && config.maxBytes > 0 ? config.maxBytes : DEFAULT_MAX_BYTES

  // The human's file, guarded at the tool seam. `write`/`edit` resolve the path the tool
  // was given; `bash`/`pwsh` are a string match because a command is not parsed here. The
  // panel's save is a COMMAND, not a tool, so it never reaches this listener - which is
  // exactly why the human keeps the pen.
  ctx.on('tools/pre-execute', (exec, next) => {
    const name = exec?.name
    if (name !== 'write' && name !== 'edit' && name !== 'bash' && name !== 'pwsh') return next()
    const cwd = workingDir(exec?.agent)
    const target = rulesPath(config, cwd)
    if (name === 'write' || name === 'edit') {
      const raw = exec.arguments?.file_path ?? exec.arguments?.path ?? exec.arguments?.filePath
      if (typeof raw !== 'string' || raw === '') return next()
      const resolved = isAbsolute(raw) ? raw : resolve(cwd, raw)
      if (!samePath(resolved, target)) return next()
      ctx.logger.warn(`project-rules: denied ${name} to ${resolved} (${RULES_HUMAN_ONLY})`)
      return { kind: 'deny', reason: `${RULES_DENY_REASON}\nFile: ${resolved}` }
    }
    const command = exec.arguments?.command
    if (!commandNamesRules(command, cwd, target)) return next()
    ctx.logger.warn(`project-rules: denied ${name} command naming ${target} (${RULES_HUMAN_ONLY})`)
    return { kind: 'deny', reason: `${RULES_DENY_REASON}\nCommand: ${String(command).slice(0, 200)}` }
  })

  // Every agent - root and delegated child - reads the same workspace file. Registration
  // happens per agent because a section lives on `agent.ctx`, and the freeze listens to
  // that agent's own session only.
  ctx.on('agent/created', ({ agent }) => {
    const cwd = workingDir(agent)
    const state = createRulesState(config)
    agent.ctx.on('session/event', (session, event) => {
      if (session === agent.session && event?.type === 'turn/start') state.refresh(cwd)
    })
    agent.ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: () => state.text(cwd),
    })
  })

  ctx.commands.register({
    name: 'project-rules',
    description: 'Read or save the workspace rules file (.dsh/rules.md) used by the Rules panel.',
    recordInput: false,
    handler: (invocation) => {
      let op
      try {
        op = JSON.parse(invocation.rawInput)
      } catch {
        return { kind: 'error', text: 'project-rules: expected a JSON operation' }
      }
      const cwd = workingDir(invocation.agent)
      const path = rulesPath(config, cwd)
      try {
        if (op?.op === 'read') {
          const rules = readRules(path, maxBytes)
          return { kind: 'success', text: JSON.stringify({ ok: true, path, text: rules.text, bytes: rules.bytes }) }
        }
        if (op?.op === 'save') {
          const bytes = writeRules(path, op.text, maxBytes)
          // Deliberately does NOT touch the in-memory section: the next turn's freeze
          // is the only place the new rules can reach the prompt.
          return { kind: 'success', text: JSON.stringify({ ok: true, bytes, path }) }
        }
        return { kind: 'error', text: 'project-rules: unknown op (read | save)' }
      } catch (error) {
        return { kind: 'error', text: String(error?.message ?? error) }
      }
    },
  })
}

export { readRules, writeRules, rulesPath, createRulesState }
