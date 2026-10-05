/**
 * PURPOSE
 *   Read a provider usage export without a dependency on an external unzip binary
 *   or a CSV library, so the same command runs unchanged on either platform the
 *   kit supports and against either shape the export arrives in: the downloaded
 *   `.zip`, or a directory of the CSV files it contains.
 *
 *   The archive is a ZIP whose entries the kit must reach by its own means. The
 *   kit ships no runtime dependencies and cannot assume an `unzip` executable
 *   exists, so the small part of the ZIP format the export actually uses —
 *   stored and deflated entries, reached through the central directory — is
 *   implemented here rather than shelled out to.
 *
 * INPUTS
 *   `readExport(source)` takes either a path to a `.zip` file or a path to a
 *   directory holding `amount-*.csv` and `cost-*.csv`.
 *   `parseCsv(text)` takes the raw text of one such file.
 *
 * OUTPUTS
 *   `readExport(source)` → `{source, amounts, costs, files, dropped, useCases}`
 *   where `amounts` and `costs` are typed row objects, `files` names the entries
 *   read, `dropped` lists the identity columns found and removed at the parse
 *   boundary, and `useCases` is a `{label, entries, size}` mapping from a key NAME
 *   to the opaque `use-case-N` label a report may group by. The names themselves
 *   are never part of a row.
 *   `parseCsv(text)` → `{header, rows}`, `rows` being string arrays.
 *   `readZipEntries(bytes)` → `Map<entryName, Buffer>`.
 *   `exportWindow(amounts, costs, offsetMinutes)` → `{from, to, startMs, endMs}`.
 *   `newestExport(directory)` → the newest `usage_data_*.zip` path, or `null`.
 *   Amount rows carry `{day, startIso, endIso, model, useCase, type, price, amount}`
 *   with `price` a number or `null`, `amount` a number, and `useCase` the opaque
 *   label or `null`. Cost rows carry `{day, startIso, endIso, model, walletType,
 *   cost, currency}`. `day` is always `YYYY-MM-DD`; `startIso`/`endIso` are `null`
 *   when the export used its older single-date column.
 *
 * KEYWORDS
 *   usage export, zip, central directory, inflateRaw, csv, bom, parsing, schema,
 *   redaction, identity columns, use case
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An identity column is dropped whether or not the export carries it: a header
 *     without `user_id` simply contributes nothing to `dropped`, so both export
 *     shapes parse with one reader.
 *   - A key name that is empty or absent gets `useCase: null`, which a report shows
 *     as an unlabelled bucket rather than inventing a name for it.
 *   - Either of the two date schemas the export has used is accepted: a row's
 *     interval as two ISO timestamps, or a single `YYYYMMDD` `utc_date`. Both
 *     resolve to the same `day`, so a caller never branches on the schema.
 *   - A row whose date column is absent, empty or unparseable gets `day: null`;
 *     it is still returned, so the analytics can report it as unusable rather
 *     than drop usage silently.
 *   - A byte-order mark at the head of a CSV is stripped; the export writes one,
 *     and left in place it becomes part of the first column's name and every
 *     lookup by that name silently misses.
 *   - Either line ending is accepted, and a quoted field may contain a comma, a
 *     doubled quote or a newline.
 *   - A field that is absent or empty parses to `null` for the numeric columns
 *     (`price`), which is how a `request_count` row is distinguished from a
 *     priced token row.
 *   - A row shorter than the header contributes `null` for the missing columns
 *     rather than throwing.
 *   - A ZIP entry compressed with a method this reader does not implement, or an
 *     entry whose sizes need the ZIP64 extension, throws naming the entry; it is
 *     never returned decompressed-as-empty, which would look like a month of no
 *     usage.
 *   - A source that is neither a readable zip nor a directory holding the two
 *     files throws a message naming what was found.
 */

import { inflateRawSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IDENTITY_COLUMNS, labelFactory } from './redaction.mjs'

/** ZIP local-file-header signature. */
const LOCAL_HEADER = 0x04034b50
/** ZIP central-directory-header signature. */
const CENTRAL_HEADER = 0x02014b50
/** ZIP end-of-central-directory signature. */
const EOCD = 0x06054b50
/** The sentinel a ZIP64 archive writes where a 32-bit size or offset would go. */
const ZIP64_SENTINEL = 0xffffffff

/**
 * Strip a UTF-8 byte-order mark from decoded text.
 *
 * @param text - Decoded file text.
 * @returns The text without a leading U+FEFF, or the text unchanged.
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Parse CSV text into a header and rows.
 *
 * A character scan rather than a split on commas, because a quoted field may
 * contain the delimiter, a doubled quote, or a newline, and splitting first
 * cannot be repaired afterwards.
 *
 * @param text - Raw CSV text, with or without a byte-order mark.
 * @returns `{header, rows}`; `rows` are string arrays that may be shorter than
 *   the header when a record omits trailing fields.
 */
export function parseCsv(text) {
  const clean = stripBom(text)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let index = 0
  while (index < clean.length) {
    const char = clean[index]
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"' && field.length === 0) {
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (char === '\r') {
      index += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += 1
      continue
    }
    field += char
    index += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const [header = [], ...data] = rows
  return { header, rows: data }
}

/**
 * Read every entry of a ZIP archive.
 *
 * Walks the central directory rather than the local headers, because only the
 * central directory is guaranteed to carry a complete index; each entry's bytes
 * are then located through its own local header, whose name and extra lengths
 * may differ from the central copy.
 *
 * @param bytes - The archive's bytes.
 * @returns `Map<string, Buffer>` keyed by entry name, in central-directory order.
 * @throws When the archive is not a ZIP, when an entry's sizes require ZIP64, or
 *   when an entry uses a compression method other than store or deflate.
 */
export function readZipEntries(bytes) {
  let eocd = bytes.length - 22
  while (eocd >= 0 && bytes.readUInt32LE(eocd) !== EOCD) eocd -= 1
  if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record found')
  const count = bytes.readUInt16LE(eocd + 10)
  const centralOffset = bytes.readUInt32LE(eocd + 16)
  const entries = new Map()
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_HEADER) {
      throw new Error(`corrupt ZIP: central directory entry ${index} has a bad signature`)
    }
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    if (compressedSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL) {
      throw new Error(`ZIP64 entry is not supported: ${name}`)
    }
    if (name.endsWith('/')) {
      cursor += 46 + nameLength + extraLength + commentLength
      continue
    }
    if (bytes.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(`corrupt ZIP: local header for ${name} has a bad signature`)
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) entries.set(name, Buffer.from(raw))
    else if (method === 8) entries.set(name, inflateRawSync(raw))
    else throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}`)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Convert a CSV field to a number, treating an empty field as absent.
 *
 * @param field - The raw field, or undefined when the row was short.
 * @returns The parsed number, or `null` when the field is absent, empty or not a
 *   finite number.
 */
function toNumber(field) {
  if (field === undefined || field === null) return null
  const trimmed = String(field).trim()
  if (trimmed.length === 0) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * Map parsed CSV rows onto objects keyed by the file's own header.
 *
 * @param text - Raw CSV text.
 * @returns An array of plain objects; a column the row omits is `null`.
 */
function rowsAsObjects(text) {
  const { header, rows } = parseCsv(text)
  return rows.map((cells) => {
    const record = {}
    header.forEach((name, index) => {
      record[name] = cells[index] === undefined ? null : cells[index]
    })
    return record
  })
}

/**
 * Read the two CSV files of an export from a directory.
 *
 * @param directory - Absolute path to a directory holding the export's CSVs.
 * @returns `Map<string, string>` of entry name to text.
 * @throws When no `amount-*.csv` or no `cost-*.csv` is present.
 */
function readExportDirectory(directory) {
  const names = readdirSync(directory).filter((name) => name.endsWith('.csv'))
  const amountName = names.find((name) => name.startsWith('amount-'))
  const costName = names.find((name) => name.startsWith('cost-'))
  if (!amountName || !costName) {
    throw new Error(
      `no usage export in ${directory}: expected one amount-*.csv and one cost-*.csv, found ` +
        (names.length === 0 ? 'no .csv files' : names.join(', ')),
    )
  }
  return new Map([
    [amountName, readFileSync(join(directory, amountName), 'utf8')],
    [costName, readFileSync(join(directory, costName), 'utf8')],
  ])
}

/**
 * Read the two CSV files of an export from a ZIP archive.
 *
 * @param archivePath - Absolute path to the `.zip`.
 * @returns `Map<string, string>` of entry name to text.
 * @throws When the archive holds no `amount-*.csv` or no `cost-*.csv`.
 */
function readExportZip(archivePath) {
  const entries = readZipEntries(readFileSync(archivePath))
  const texts = new Map()
  for (const [name, buffer] of entries) {
    const base = name.split('/').pop()
    if (base.endsWith('.csv')) texts.set(base, stripBom(buffer.toString('utf8')))
  }
  const names = [...texts.keys()]
  if (!names.some((name) => name.startsWith('amount-')) || !names.some((name) => name.startsWith('cost-'))) {
    throw new Error(
      `no usage export in ${archivePath}: expected one amount-*.csv and one cost-*.csv, found ` +
        (names.length === 0 ? 'no .csv entries' : names.join(', ')),
    )
  }
  return texts
}

/**
 * Resolve the calendar day a row belongs to, across both export schemas.
 *
 * The current export states a row's interval as two ISO timestamps; an older
 * export states a single `utc_date` as `YYYYMMDD` and no interval at all. The day
 * is what every metric groups by, so it is resolved once here rather than by
 * every caller re-deciding which column the export happened to use.
 *
 * @param row - A CSV row keyed by its own header.
 * @returns `YYYY-MM-DD`, or `null` when neither column carries a usable date.
 */
function resolveDay(row) {
  if (typeof row.start_time_iso === 'string' && row.start_time_iso.length >= 10) {
    return row.start_time_iso.slice(0, 10)
  }
  const compact = row.utc_date
  if (typeof compact === 'string' && /^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  }
  return null
}

/**
 * Read a usage export from a ZIP archive or an extracted directory.
 *
 * @param source - Path to a `.zip` file or to a directory of CSVs.
 * @returns `{source, files, amounts, costs}`. `amounts` and `costs` are `[]` when
 *   the corresponding file is present but empty, never `null`. Every row carries
 *   `day` as `YYYY-MM-DD`, resolved from whichever date column the export uses;
 *   `startIso` and `endIso` are `null` in the older single-date schema.
 * @throws Propagates the reader's error when the source is neither shape, or
 *   when the archive lacks one of the two files.
 */
export function readExport(source) {
  const stats = statSync(source)
  const texts = stats.isDirectory() ? readExportDirectory(source) : readExportZip(source)
  const files = [...texts.keys()]
  const amountName = files.find((name) => name.startsWith('amount-'))
  const costName = files.find((name) => name.startsWith('cost-'))

  // Identity material is dropped HERE, at the parse boundary, rather than filtered out
  // of the report: a value that never enters a row cannot be printed by a later change
  // to a template. The key NAME is read once, mapped to an opaque label the report may
  // group by, and then discarded — which keys exist is identity material, how many
  // there are and how spend splits between them is not.
  const useCases = labelFactory()
  const amountRows = rowsAsObjects(texts.get(amountName))
  const costRows = rowsAsObjects(texts.get(costName))
  const dropped = new Set()
  for (const row of [...amountRows, ...costRows]) {
    for (const key of Object.keys(row)) {
      if (IDENTITY_COLUMNS.includes(key.toLowerCase())) dropped.add(key)
    }
  }

  const amounts = amountRows.map((row) => ({
    day: resolveDay(row),
    startIso: row.start_time_iso ?? null,
    endIso: row.end_time_iso ?? null,
    model: row.model,
    useCase: useCases.label(row.api_key_name),
    type: row.type,
    price: toNumber(row.price),
    amount: toNumber(row.amount) ?? 0,
  }))

  const costs = costRows.map((row) => ({
    day: resolveDay(row),
    startIso: row.start_time_iso ?? null,
    endIso: row.end_time_iso ?? null,
    model: row.model,
    walletType: row.wallet_type,
    cost: toNumber(row.cost) ?? 0,
    currency: row.currency,
  }))

  return { source, files, amounts, costs, dropped: [...dropped].sort(), useCases }
}

/**
 * Find the most recently written usage export in a directory.
 *
 * The export is downloaded by hand and its name carries the period it covers, so
 * the newest file is the newest period. Selecting it here rather than in a build
 * file keeps the choice in the portable layer and out of a shell.
 *
 * @param directory - Absolute path to search.
 * @returns The absolute path of the newest `usage_data_*.zip`, or `null` when the
 *   directory does not exist or holds no such file.
 */
export function newestExport(directory) {
  let names
  try {
    names = readdirSync(directory)
  } catch {
    return null
  }
  let best = null
  for (const name of names) {
    if (!/^usage_data_.*\.zip$/.test(name)) continue
    const path = join(directory, name)
    let modified
    try {
      modified = statSync(path).mtimeMs
    } catch {
      continue
    }
    if (best === null || modified > best.modified) best = { path, modified }
  }
  return best === null ? null : best.path
}

/**
 * Derive the epoch window an export covers, from the days its rows carry.
 *
 * The export states each row's day, so the window is read from the data rather
 * than assumed to be a calendar month. Agent-hours must be measured over this
 * same window, or the denominator covers time the numerator does not pay for.
 *
 * @param amounts - Amount rows from `readExport`.
 * @param costs - Cost rows from `readExport`.
 * @param offsetMinutes - The UTC offset that defines a reporting day, so the
 *   window's bounds land on that day's midnight rather than on UTC midnight.
 * @returns `{from, to, startMs, endMs}`, where `startMs` is the first day's local
 *   midnight and `endMs` the midnight after the last day; `null`s and NaN bounds
 *   when no row carries a day.
 */
export function exportWindow(amounts, costs, offsetMinutes = 0) {
  const days = [...amounts, ...costs].map((row) => row.day).filter((day) => typeof day === 'string')
  if (days.length === 0) return { from: null, to: null, startMs: Number.NaN, endMs: Number.NaN }
  days.sort()
  const from = days[0]
  const to = days[days.length - 1]
  const shift = offsetMinutes * 60_000
  const startMs = Date.parse(`${from}T00:00:00.000Z`) - shift
  const endMs = Date.parse(`${to}T00:00:00.000Z`) - shift + 24 * 3_600_000
  return { from, to, startMs, endMs }
}
