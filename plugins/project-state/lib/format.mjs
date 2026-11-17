/**
 * PURPOSE
 *   The file format of the project state: one markdown file per entity, a YAML frontmatter
 *   block and a free-text body. The format is DETERMINISTIC — the same entity always
 *   serializes to the same bytes — because the journal replays these bytes and git diffs them.
 *
 * WHAT A HUMAN SEES
 *   A file they can read and edit in git: `---` frontmatter, then the body. A broken edit is a
 *   `frontmatter_invalid` finding in `verify()`, never a silent overwrite.
 *
 * PARSING SHAPE
 *   The subset is deliberately small and line-based (no YAML dependency in the tarball):
 *     key: scalar            (string, number, true/false, quoted string)
 *     key: [a, b]            (inline list of scalars)
 *     key:                   (block list follows, `- item` or `- key: value` lines)
 *       - item
 *   Anything outside the subset is reported as an error with its line number.
 *
 * OUTPUT SHAPE
 *   { ok: true, frontmatter, body } or { ok: false, error }
 */

const FM = '---'

/** Quote a scalar only when the plain form would not parse back to the same string. */
function scalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'null'
  const text = String(value)
  if (text === '') return '""'
  if (/^[A-Za-z0-9._:/@+-]+$/.test(text) && !/^(true|false|null|-?\d+(\.\d+)?)$/.test(text)) return text
  return JSON.stringify(text)
}

/** Serialize a value: scalars, inline lists of scalars, a list of maps (links), a list (criteria). */
function renderValue(key, value, indent, lines) {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      lines.push(`${indent}${key}: [${value.map((item) => scalar(item)).join(', ')}]`)
      return
    }
    lines.push(`${indent}${key}:`)
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item)
        const [firstKey, firstValue] = entries[0]
        lines.push(`${indent}  - ${firstKey}: ${scalar(firstValue)}`)
        for (const [k, v] of entries.slice(1)) lines.push(`${indent}    ${k}: ${scalar(v)}`)
      } else {
        lines.push(`${indent}  - ${scalar(item)}`)
      }
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    lines.push(`${indent}${key}:`)
    for (const [k, v] of Object.entries(value)) renderValue(k, v, `${indent}  `, lines)
    return
  }
  lines.push(`${indent}${key}: ${scalar(value)}`)
}

/**
 * Serialize an entity to the canonical file text.
 *
 * Field order is fixed (id, kind, title, status, revision, timestamps, then the kind-specific
 * fields alphabetically, then links), so two runs with the same entity produce the same bytes.
 *
 * @param {{frontmatter: object, body?: string}} entity
 * @returns {string} the file text, ending with exactly one newline
 */
export function serialize(entity) {
  const fm = entity.frontmatter ?? {}
  const order = ['id', 'kind', 'title', 'status', 'revision', 'createdAt', 'updatedAt']
  const rest = Object.keys(fm)
    .filter((key) => !order.includes(key) && key !== 'links')
    .sort()
  const lines = [FM]
  for (const key of [...order, ...rest]) {
    if (fm[key] === undefined) continue
    renderValue(key, fm[key], '', lines)
  }
  if (Array.isArray(fm.links) && fm.links.length > 0) renderValue('links', fm.links, '', lines)
  lines.push(FM)
  const body = typeof entity.body === 'string' ? entity.body : ''
  const normalized = body.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  return `${lines.join('\n')}\n${normalized === '' ? '' : `\n${normalized}\n`}`
}

/** Strip one layer of quotes from a scalar, or report that it is not a quoted string. */
function unquote(text) {
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch {
      return { ok: false, error: `unterminated string ${text}` }
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return { ok: true, value: text.slice(1, -1).replace(/''/g, "'") }
  return { ok: true, value: undefined }
}

/** Parse a scalar: quoted string, number, boolean, null, or the raw string. */
function parseScalar(text) {
  const trimmed = text.trim()
  const quoted = unquote(trimmed)
  if (quoted.ok === false) return quoted
  if (quoted.value !== undefined) return quoted
  if (trimmed === 'true') return { ok: true, value: true }
  if (trimmed === 'false') return { ok: true, value: false }
  if (trimmed === 'null' || trimmed === '~') return { ok: true, value: null }
  if (/^-?\d+$/.test(trimmed)) return { ok: true, value: Number(trimmed) }
  if (/^-?\d+\.\d+$/.test(trimmed)) return { ok: true, value: Number(trimmed) }
  if (trimmed === '') return { ok: false, error: 'empty scalar' }
  return { ok: true, value: trimmed }
}

/**
 * Parse a state file's frontmatter and body.
 *
 * @param {string} text - the file text.
 * @returns {ok: true, frontmatter, body} or {ok: false, error, line}
 */
export function parse(text) {
  if (typeof text !== 'string') return { ok: false, error: 'not a string' }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== FM) return { ok: false, error: 'missing opening ---', line: 1 }
  const close = lines.indexOf(FM, 1)
  if (close < 0) return { ok: false, error: 'missing closing ---', line: lines.length }
  const frontmatter = {}
  let currentList = null
  let currentMap = null
  for (let index = 1; index < close; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (top !== null) {
      const [, key, value] = top
      if (value.trim() === '') {
        if (key === 'links') {
          frontmatter.links = currentList = []
          continue
        }
        // A nested one-level map (`analysisRef:` then `  initiative: x`) or a block list
        // (`criteria:` then `  - c`); decide by the next non-empty line.
        let nextLine = ''
        for (let probe = index + 1; probe < close; probe += 1) {
          if (lines[probe].trim() === '') continue
          nextLine = lines[probe]
          break
        }
        if (/^\s{2}[A-Za-z][\w-]*:\s/.test(nextLine)) {
          frontmatter[key] = {}
          currentList = null
          currentMap = frontmatter[key]
          continue
        }
        currentList = []
        currentMap = null
        frontmatter[key] = currentList
        continue
      }
      if (value.trim().startsWith('[') && value.trim().endsWith(']')) {
        const inner = value.trim().slice(1, -1).trim()
        const items = inner === '' ? [] : inner.split(',').map((part) => part.trim())
        const parsed = items.map((part) => parseScalar(part))
        const bad = parsed.find((item) => item.ok === false)
        if (bad !== undefined) return { ok: false, error: bad.error, line: index + 1 }
        frontmatter[key] = parsed.map((item) => item.value)
        currentList = null
        continue
      }
      const parsed = parseScalar(value)
      if (parsed.ok === false) return { ok: false, error: parsed.error, line: index + 1 }
      frontmatter[key] = parsed.value
      currentList = null
      continue
    }
    const mapField = /^\s{2}([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (mapField !== null && currentMap !== null) {
      const parsed = parseScalar(mapField[2])
      if (parsed.ok === false) return { ok: false, error: parsed.error, line: index + 1 }
      currentMap[mapField[1]] = parsed.value
      continue
    }
    const listItem = /^\s{2}-\s*(.*)$/.exec(line)
    if (listItem !== null && currentList !== null) {
      const item = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(listItem[1])
      if (item !== null) {
        const parsed = parseScalar(item[2])
        if (parsed.ok === false) return { ok: false, error: parsed.error, line: index + 1 }
        const entry = { [item[1]]: parsed.value }
        currentList.push(entry)
      } else {
        const parsed = parseScalar(listItem[1])
        if (parsed.ok === false) return { ok: false, error: parsed.error, line: index + 1 }
        currentList.push(parsed.value)
      }
      continue
    }
    const nested = /^\s{4}([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (nested !== null && currentList !== null && currentList.length > 0) {
      const last = currentList[currentList.length - 1]
      if (last === null || typeof last !== 'object' || Array.isArray(last)) return { ok: false, error: 'nested field on a scalar list', line: index + 1 }
      const parsed = parseScalar(nested[2])
      if (parsed.ok === false) return { ok: false, error: parsed.error, line: index + 1 }
      last[nested[1]] = parsed.value
      continue
    }
    return { ok: false, error: `unparsable line: ${line}`, line: index + 1 }
  }
  // Links arrive as [{kind}, {id, hash}, {id, hash}] because the writer groups them; fold by
  // order into one object per link.
  if (Array.isArray(frontmatter.links)) {
    const links = []
    let pending = null
    for (const entry of frontmatter.links) {
      if (entry !== null && typeof entry === 'object' && entry.kind !== undefined) {
        pending = { ...entry }
        links.push(pending)
      } else if (entry !== null && typeof entry === 'object' && pending !== null) {
        Object.assign(pending, entry)
      } else if (typeof entry === 'string') {
        links.push(entry)
      }
    }
    frontmatter.links = links.filter((link) => typeof link === 'object' && link.id !== undefined)
  }
  const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '')
  return { ok: true, frontmatter, body }
}
