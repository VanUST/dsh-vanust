/**
 * PURPOSE
 *   One paper-research tool family for the harness: search arXiv and Hugging Face,
 *   list Hugging Face daily papers, and download a paper's PDF with a text extraction
 *   when `pdftotext` is installed. The literature-review skill calls these tools; before
 *   this plugin they named tools that did not exist.
 *
 * INPUTS
 *   Public HTTP APIs, no keys:
 *   - arXiv Atom:  https://export.arxiv.org/api/query
 *   - HF search:   https://huggingface.co/api/papers/search?q=...
 *   - HF daily:    https://huggingface.co/api/daily_papers?limit=...
 *   - arXiv PDF:   https://arxiv.org/pdf/<id>
 *
 * OUTPUTS
 *   JSON-serialisable objects; each result is `{source,id,title,authors,published,summary,url,pdfUrl,...}`.
 *   A failed source is reported in `errors`; a failure of every requested source is thrown so
 *   the tool call is visibly failed rather than an empty success.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Empty query: rejected before any network call.
 *   - arXiv XML: entities decoded, tags stripped, author/category/link attributes parsed.
 *   - HF shape drift: `paper` or the flat object is accepted; missing fields become empty.
 *   - Download: only safe arXiv ids; PDF magic checked; size capped; `pdftotext` absence is a
 *     warning on a successful PDF download, not a failed download.
 *   - No network: the fetch error is named per source; partial results survive.
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { defineTool } from '@deepseek-ai/dsh-tools'

const USER_AGENT = 'dsh-papers/0.1 (+https://github.com/VanUST/dsh-vanust)'
const ARXIV_QUERY = 'https://export.arxiv.org/api/query'
const HF_SEARCH = 'https://huggingface.co/api/papers/search'
const HF_DAILY = 'https://huggingface.co/api/daily_papers'
const ARXIV_PDF = 'https://arxiv.org/pdf'
const FETCH_TIMEOUT_MS = 20_000
const PDF_LIMIT_BYTES = 30 * 1024 * 1024
const TEXT_PREVIEW_CHARS = 6_000
const MAX_LIMIT = 25

/** Strip `undefined` fields so the harness's lossless-JSON tool check accepts the value. */
export function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value))
}
const execFileAsync = promisify(execFile)

/** Decode the XML entities the paper feeds actually emit. */
export function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    const key = String(entity).toLowerCase()
    if (Object.hasOwn(named, key)) return named[key]
    const numeric = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10)
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return match
    try {
      return String.fromCodePoint(numeric)
    } catch {
      return match
    }
  })
}

/** Strip tags, decode entities and collapse whitespace in a feed text node. */
export function cleanText(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Return the text of the first `<tag>` inside an Atom entry, or an empty string. */
function xmlText(entry, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(entry)
  return match === null ? '' : cleanText(match[1])
}

/** Parse `key="value"` attributes from a link tag body. */
function attributes(body) {
  const out = {}
  for (const match of String(body).matchAll(/([a-zA-Z:_-]+)="([^"]*)"/g)) out[match[1]] = decodeEntities(match[2])
  return out
}

/**
 * Parse an arXiv Atom feed into normalised results.
 *
 * @param {string} xml - Atom response body.
 * @returns {object[]} Papers in feed order.
 */
export function parseArxivFeed(xml) {
  const entries = [...String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1])
  return entries.map((entry) => {
    const rawId = xmlText(entry, 'id')
    const idMatch = /\/abs\/([^/]+?)(v\d+)?$/i.exec(rawId)
    const id = idMatch === null ? rawId : idMatch[1]
    const version = idMatch?.[2] ?? ''
    const authors = [...entry.matchAll(/<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
      .map((match) => cleanText(match[1]))
      .filter(Boolean)
    const categories = [...entry.matchAll(/<category\b[^>]*term="([^"]+)"/gi)].map((match) => decodeEntities(match[1]))
    const primary = /<arxiv:primary_category\b[^>]*term="([^"]+)"/i.exec(entry)?.[1] ?? categories[0] ?? ''
    let url = ''
    let pdfUrl = ''
    for (const match of entry.matchAll(/<link\b([^>]*)\/?>/gi)) {
      const attrs = attributes(match[1])
      if (attrs.rel === 'alternate' && typeof attrs.href === 'string') url = attrs.href
      if (attrs.title === 'pdf' && typeof attrs.href === 'string') pdfUrl = attrs.href
    }
    const summary = xmlText(entry, 'summary')
    return {
      source: 'arxiv',
      id,
      version,
      title: xmlText(entry, 'title'),
      authors,
      published: xmlText(entry, 'published'),
      updated: xmlText(entry, 'updated'),
      summary,
      url: url === '' ? `https://arxiv.org/abs/${id}` : url,
      pdfUrl: pdfUrl === '' ? `https://arxiv.org/pdf/${id}` : pdfUrl,
      categories,
      primaryCategory: primary === '' ? null : primary,
    }
  })
}

/** Normalise one Hugging Face paper search/daily item, accepting both known shapes. */
export function normalizeHuggingFace(item) {
  const paper = item?.paper ?? item ?? {}
  const id = String(paper.id ?? '').trim()
  const authors = Array.isArray(paper.authors)
    ? paper.authors.map((author) => (typeof author === 'string' ? author : author?.name)).filter(Boolean)
    : []
  const keywords = Array.isArray(paper.ai_keywords) ? paper.ai_keywords.filter((word) => typeof word === 'string') : []
  const arxivLike = /^\d{4}\.\d{4,5}(v\d+)?$/.test(id)
  return {
    source: 'huggingface',
    id,
    version: '',
    title: String(paper.title ?? item?.title ?? '').trim(),
    authors,
    published: String(paper.publishedAt ?? item?.publishedAt ?? ''),
    updated: '',
    summary: cleanText(paper.summary ?? item?.summary ?? ''),
    url: id === '' ? 'https://huggingface.co/papers' : `https://huggingface.co/papers/${id}`,
    pdfUrl: arxivLike ? `https://arxiv.org/pdf/${id}` : '',
    categories: keywords,
    primaryCategory: null,
    upvotes: Number.isFinite(Number(paper.upvotes)) ? Number(paper.upvotes) : undefined,
    aiSummary: typeof paper.ai_summary === 'string' && paper.ai_summary !== '' ? cleanText(paper.ai_summary) : undefined,
    githubRepo: typeof paper.githubRepo === 'string' && paper.githubRepo !== '' ? paper.githubRepo : undefined,
  }
}

/** Clamp a requested result count. */
export function clampLimit(value, fallback = 8) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(number)))
}

/** Build the arXiv `search_query` from the free text and optional filters. */
export function arxivQuery(query, { author = '', category = '' } = {}) {
  const text = String(query).trim()
  if (text === '') throw new Error('query must not be empty')
  const knownField = /^(all|ti|au|abs|co|jr|rn|cat|id):/i.test(text)
  const parts = [knownField ? text : `all:"${text.replaceAll('"', '\\"')}"`]
  const writer = String(author).trim()
  if (writer !== '') parts.push(`au:"${writer.replaceAll('"', '\\"')}"`)
  const section = String(category).trim()
  if (section !== '') parts.push(`cat:${section}`)
  return parts.join(' AND ')
}

/**
 * Fetch with up to three attempts for a transient network error, a timeout, 429 or a 5xx.
 *
 * THREE ATTEMPTS, NOT TWO, and that number is measured rather than chosen: on this
 * deployment a web call commonly fails one or two times and then succeeds — the
 * transport is flaky, not broken (2026-10-26). A single retry turned a working request
 * into a reported failure often enough to be misleading. Backoff doubles (500, 1000 ms)
 * and a `Retry-After` header wins over it; a real 4xx still fails immediately, so the
 * retries cannot hide a wrong request.
 *
 * @param {string} url
 * @param {string} accept
 * @returns {Promise<Response>}
 */
async function request(url, accept) {
  const ATTEMPTS = 3
  let last = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const lastAttempt = attempt === ATTEMPTS - 1
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      })
      if (response.ok) return response
      if (!lastAttempt && (response.status === 429 || response.status >= 500)) {
        last = new Error(`HTTP ${response.status} from ${url}`)
        const retryAfter = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : 500 * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, wait))
        continue
      }
      throw new Error(`HTTP ${response.status} from ${url}`)
    } catch (error) {
      if (error?.message?.startsWith('HTTP ')) throw error
      const detail = error?.cause?.code === undefined ? error.message : `${error.message} (${error.cause.code})`
      last = new Error(`network: ${detail}`)
      if (!lastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        continue
      }
    }
  }
  throw last ?? new Error(`network: request to ${url} failed`)
}

/** Fetch text with the shared retry policy. */
async function fetchText(url, accept) {
  const response = await request(url, accept)
  return response.text()
}

/** Fetch JSON with the shared retry policy; an array is required. */
async function fetchJson(url) {
  const response = await request(url, 'application/json')
  const parsed = await response.json()
  if (!Array.isArray(parsed)) throw new Error(`unexpected response from ${url}: expected an array`)
  return parsed
}

/**
 * Search arXiv.
 *
 * @param {string} query - Free text or a field-prefixed arXiv query.
 * @param {{limit?: number, sort?: string, author?: string, category?: string}} options
 * @returns {Promise<object[]>}
 */
export async function searchArxiv(query, options = {}) {
  const limit = clampLimit(options.limit)
  const sortBy = options.sort === 'submitted' ? 'submittedDate' : options.sort === 'updated' ? 'lastUpdatedDate' : 'relevance'
  const params = new URLSearchParams({
    search_query: arxivQuery(query, options),
    start: '0',
    max_results: String(limit),
    sortBy,
    sortOrder: 'descending',
  })
  const xml = await fetchText(`${ARXIV_QUERY}?${params}`, 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8')
  return parseArxivFeed(xml).slice(0, limit)
}

/**
 * Search Hugging Face papers.
 *
 * @param {string} query - Free text.
 * @param {{limit?: number}} options
 * @returns {Promise<object[]>}
 */
export async function searchHuggingFace(query, options = {}) {
  const text = String(query).trim()
  if (text === '') throw new Error('query must not be empty')
  const limit = clampLimit(options.limit)
  const params = new URLSearchParams({ q: text, limit: String(limit) })
  const items = await fetchJson(`${HF_SEARCH}?${params}`)
  return items.map(normalizeHuggingFace).slice(0, limit)
}

/**
 * Hugging Face daily papers, newest first.
 *
 * @param {{limit?: number}} options
 * @returns {Promise<object[]>}
 */
export async function trendingHuggingFace(options = {}) {
  const limit = clampLimit(options.limit, 10)
  const params = new URLSearchParams({ limit: String(limit) })
  const items = await fetchJson(`${HF_DAILY}?${params}`)
  return items.map(normalizeHuggingFace).slice(0, limit)
}

/**
 * Search one or both sources, preserving successful partial results.
 *
 * @param {{query: string, source?: string, limit?: number, sort?: string, author?: string, category?: string}} args
 * @returns {Promise<object>} `{ok,query,source,count,results,errors,notes}`
 */
export async function searchPapers(args) {
  const query = String(args?.query ?? '').trim()
  if (query === '') throw new Error('papers_search: query must not be empty')
  const requested = String(args?.source ?? 'both').toLowerCase()
  const source = ['arxiv', 'huggingface', 'both'].includes(requested) ? requested : null
  if (source === null) throw new Error('papers_search: source must be "arxiv", "huggingface" or "both"')
  const limit = clampLimit(args?.limit)
  const notes = []
  if (source === 'huggingface' && (args?.author || args?.category)) notes.push('author/category filters apply to arXiv only')
  const calls = []
  if (source === 'arxiv' || source === 'both') calls.push({ name: 'arxiv', run: () => searchArxiv(query, { limit, sort: args?.sort, author: args?.author, category: args?.category }) })
  if (source === 'huggingface' || source === 'both') calls.push({ name: 'huggingface', run: () => searchHuggingFace(query, { limit }) })
  const settled = await Promise.allSettled(calls.map((call) => call.run()))
  const results = []
  const errors = []
  settled.forEach((outcome, index) => {
    const call = calls[index]
    if (outcome.status === 'fulfilled') results.push(...outcome.value)
    else errors.push(`${call.name}: ${outcome.reason?.message ?? String(outcome.reason)}`)
  })
  if (results.length === 0 && errors.length > 0) throw new Error(`papers_search failed for every source — ${errors.join(' | ')}`)
  return jsonSafe({ ok: true, query, source, count: results.length, results, errors, notes })
}

/** Reject a path-traversal attempt and accept modern and old-style arXiv ids. */
export function safePaperId(value) {
  const id = String(value ?? '').trim()
  if (id === '' || id.includes('..') || /[\s"'<>|\\]/.test(id)) throw new Error('papers_download: invalid arXiv id')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9._-]+)?$/.test(id)) throw new Error('papers_download: invalid arXiv id')
  return id
}

/**
 * Download a paper PDF into `<workspace>/.dsh/papers` and extract text when possible.
 *
 * @param {string} rawId - arXiv id, including old-style `hep-th/9901001`.
 * @param {object} exec - Tool execution context; its session header supplies the workspace.
 * @returns {Promise<object>}
 */
export async function downloadPaper(rawId, exec) {
  const id = safePaperId(rawId)
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') throw new Error('papers_download: no workspace cwd on this session')
  const url = `${ARXIV_PDF}/${id}`
  const response = await request(url, 'application/pdf').catch((error) => {
    throw new Error(`papers_download: ${error.message}`)
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error('papers_download: the response was empty')
  if (bytes.length > PDF_LIMIT_BYTES) throw new Error(`papers_download: PDF is ${bytes.length} bytes, over the 30 MB cap`)
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error('papers_download: the response is not a PDF (arXiv may have served an error page)')
  const directory = join(cwd, '.dsh', 'papers')
  await mkdir(directory, { recursive: true })
  const stem = id.replaceAll('/', '_')
  const pdfPath = join(directory, `${stem}.pdf`)
  await writeFile(pdfPath, bytes)
  const warnings = []
  const textPath = join(directory, `${stem}.txt`)
  let text = ''
  try {
    await execFileAsync('pdftotext', [pdfPath, textPath], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
    text = await readFile(textPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') warnings.push('pdftotext is not installed; the PDF is saved but no text was extracted')
    else warnings.push(`pdftotext failed: ${error?.message ?? String(error)}`)
  }
  const info = await stat(pdfPath)
  return jsonSafe({
    ok: true,
    id,
    url,
    pdfPath,
    bytes: info.size,
    textPath: text === '' ? null : textPath,
    textChars: text.length,
    textPreview: text === '' ? '' : text.slice(0, TEXT_PREVIEW_CHARS),
    warnings,
  })
}

/** The three tools, exported separately so they are testable without a Context. */
export function paperTools(define) {
  const output = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
  const search = define({
    name: 'papers_search',
    description:
      'Search arXiv and/or Hugging Face papers. Returns title, authors, published date, abstract, canonical page, PDF link, arXiv categories, and Hugging Face upvotes/GitHub/AI summary when available. No API key. Use `source: "both"` for a literature review; one source can fail while the other still returns results.',
    parameters: {
      query: { type: 'string', required: true, description: 'Research question or keywords. A known arXiv field prefix (all:, ti:, au:, abs:, cat:, id:) is passed through; otherwise the text is searched in all fields.' },
      source: { type: 'string', description: '"arxiv", "huggingface" or "both" (default "both").' },
      limit: { type: 'number', description: 'Results per source, 1-25 (default 8).' },
      sort: { type: 'string', description: 'arXiv sort: "relevance" (default), "submitted" or "updated". Hugging Face always uses its own relevance order.' },
      author: { type: 'string', description: 'Optional author filter (arXiv only).' },
      category: { type: 'string', description: 'Optional arXiv category, e.g. cs.CL (arXiv only).' },
    },
    output,
    async execute(args) {
      return searchPapers(args ?? {})
    },
  })
  const trending = define({
    name: 'papers_trending',
    description:
      'List the current Hugging Face daily papers, newest first. Use it to see what is new before narrowing a literature review; it needs no query and no API key.',
    parameters: {
      limit: { type: 'number', description: 'Number of papers, 1-25 (default 10).' },
    },
    output,
    async execute(args) {
      const limit = clampLimit(args?.limit, 10)
      const results = await trendingHuggingFace({ limit })
      return jsonSafe({ ok: true, source: 'huggingface', count: results.length, results })
    },
  })
  const download = define({
    name: 'papers_download',
    description:
      'Download an arXiv paper PDF into `.dsh/papers` in the workspace and extract its text with pdftotext when installed. Returns the PDF path, text path, a 6k-character preview and warnings. Use it to read a shortlisted paper past its abstract; never invent a result the text does not contain.',
    parameters: {
      id: { type: 'string', required: true, description: 'arXiv id, e.g. 2005.11401 or hep-th/9901001.' },
    },
    output,
    async execute(args, exec) {
      return downloadPaper(args?.id, exec)
    },
  })
  return { search, trending, download }
}

export const name = '@cc/dsh-papers'
export const inject = ['tools']

/** Register the paper tools on a host Context. */
export function apply(ctx) {
  const tools = paperTools(defineTool)
  ctx.tools.register(tools.search)
  ctx.tools.register(tools.trending)
  ctx.tools.register(tools.download)
}
