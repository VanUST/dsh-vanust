/**
 * PURPOSE
 *   Turn a task's result into one readable page. The tool renders a structured
 *   handoff — TL;DR, objective, changes, evidence, decisions, risks, next actions,
 *   artifacts — into a self-contained A4 HTML file and, when Chrome is available,
 *   a PDF beside it. The HTML is the source of truth; the PDF is a convenience.
 *
 * INPUTS
 *   Top-level tool arguments: title, audience, objective, tldr[], changed[],
 *   evidence[{claim,proof}], decisions[{decision,why}], risks[{risk,impact,mitigation}],
 *   next[], artifacts[], out?, pdf? (default true), cwd?.
 *
 * OUTPUTS
 *   { ok, path, pdf, bytes, warnings, errors }. A render or write failure is a
 *   reported result, never a throw. A PDF failure leaves the HTML and reports the
 *   reason in warnings.
 *
 * KEYWORDS
 *   handoff, one page, HTML, PDF, Chrome, evidence, decisions, risks
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No title: { ok: false, errors: [...] }; no file written.
 *   - No Chrome: HTML is written, pdf is null, and the warning names the missing
 *     launcher. The tool never installs or downloads a browser.
 *   - A Chrome timeout or non-zero exit: the HTML remains, the PDF is removed if
 *     it is empty or partial, and the warning carries the launcher's stderr tail.
 *   - The default name includes the title slug and date, so repeated handoffs for
 *     one task do not overwrite each other silently; an explicit `out` may.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderHandoff, slug } from './render.mjs'

/** Resolve the session workspace, falling back to the process directory. */
function workingDir(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  const explicit = exec?.agent?.options?.cwd
  return typeof explicit === 'string' && explicit.length > 0 ? explicit : process.cwd()
}

/** Chrome/Chromium candidates, per platform; the first existing one wins. */
function findChrome() {
  const env = process.env.CHROME_PATH
  if (typeof env === 'string' && env !== '' && existsSync(env)) return env
  const known = process.platform === 'win32'
    ? []
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
  const names = process.platform === 'win32' ? ['chrome.exe', 'msedge.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']
  const pathDirs = String(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter((entry) => entry !== '')
  const fromPath = pathDirs.flatMap((directory) => names.map((name) => join(directory, name)))
  return [...known, ...fromPath].find((candidate) => candidate !== '' && existsSync(candidate)) ?? null
}

/**
 * Render a PDF beside the HTML.
 *
 * @param chrome - Absolute launcher path.
 * @param htmlPath - Absolute HTML path.
 * @param pdfPath - Absolute PDF path.
 * @returns `{ ok, error? }`; never throws.
 */
/**
 * Count the pages in a PDF by its page objects.
 *
 * WHY THIS EXISTS. The tool's contract is a ONE-PAGE handoff, and the item caps it
 * applies are counts, not height: on 2026-10-26 it returned `ok` with no warning
 * while shipping a TWO-PAGE PDF, twice, because the rendered content overflowed A4.
 * The label was a claim and the bytes disagreed. Counting the page objects makes the
 * disagreement visible in `warnings` instead of hiding in the file.
 *
 * @param bytes - The PDF file's bytes.
 * @returns Page count, or null when the structure could not be read.
 */
export function pdfPageCount(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : String(bytes)
  // `/Type /Page` with any spacing; `/Type /Pages` is the tree node, not a page.
  const pages = text.match(/\/Type\s*\/Page(?![s\w])/g)
  return pages === null ? null : pages.length
}

/** Write the PDF with a headless Chrome. */
function writePdf(chrome, htmlPath, pdfPath) {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-handoff-chrome-'))
  try {
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--no-pdf-header-footer',
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ], { timeout: 30000, stdio: 'ignore' })
    if (!existsSync(pdfPath) || statSync(pdfPath).size === 0) {
      try { rmSync(pdfPath, { force: true }) } catch { /* best effort */ }
      return { ok: false, error: 'Chrome exited without writing a PDF' }
    }
    return { ok: true }
  } catch (error) {
    try { rmSync(pdfPath, { force: true }) } catch { /* best effort */ }
    const tail = String(error?.stderr ?? error?.message ?? error).split('\n').slice(-3).join(' ')
    return { ok: false, error: tail.slice(0, 400) }
  } finally {
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

/** Resolve the HTML target from an explicit name or the title. */
function targetPath(args, cwd, title) {
  const requested = typeof args?.out === 'string' && args.out.trim() !== '' ? args.out.trim() : null
  if (requested !== null) {
    if (requested.includes('\0')) return null
    return isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested)
  }
  const date = new Date().toISOString().slice(0, 10)
  return resolve(cwd, 'reports', `handoff-${slug(title)}-${date}.html`)
}

/** Build the tool definition. */
export function handoffTool(defineToolFn = defineTool) {
  return defineToolFn({
    name: 'handoff',
    description: 'Render a one-page handoff for a task: TL;DR, objective, what changed, evidence, decisions, risks, next actions and artifacts. Writes a self-contained A4 HTML file and, when Chrome is available, a PDF beside it. Use it at a milestone and at the end of an initiative; do not turn it into a report.',
    parameters: {
      title: { type: 'string', required: true, description: 'Handoff title; also the default filename.' },
      audience: { type: 'string', description: 'Who reads this.' },
      objective: { type: 'string', description: 'The outcome in one paragraph.' },
      tldr: { type: 'array', items: { type: 'string' }, description: 'At most five facts, each one sentence.' },
      changed: { type: 'array', items: { type: 'string' }, description: 'What changed, in reading order.' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { claim: { type: 'string' }, proof: { type: 'string' } },
        },
        description: 'Claim/proof pairs: commands, outputs, exit codes, files, screenshots.',
      },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { decision: { type: 'string' }, why: { type: 'string' } },
        },
        description: 'Decisions worth carrying forward.',
      },
      risks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { risk: { type: 'string' }, impact: { type: 'string' }, mitigation: { type: 'string' } },
        },
        description: 'Known risks, their impact and the next check.',
      },
      next: { type: 'array', items: { type: 'string' }, description: 'Next actions, each with an owner if known.' },
      artifacts: { type: 'array', items: { type: 'string' }, description: 'Files, URLs or reports to open next.' },
      out: { type: 'string', description: 'Optional HTML path; default reports/handoff-<slug>-<date>.html.' },
      pdf: { type: 'boolean', description: 'Also render a PDF when Chrome is available. Default true.' },
      cwd: { type: 'string', description: 'Optional workspace directory; inherits the session cwd.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args, exec) {
      const cwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : workingDir(exec)
      const rendered = renderHandoff(args)
      if (rendered.html === null) return Promise.resolve({ ok: false, errors: rendered.warnings, warnings: [] })
      const target = targetPath(args, cwd, args.title)
      if (target === null) return Promise.resolve({ ok: false, errors: ['out: expected a usable file name'], warnings: rendered.warnings })
      try {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, rendered.html, 'utf8')
      } catch (error) {
        return Promise.resolve({ ok: false, errors: [`write ${target}: ${error.message}`], warnings: rendered.warnings })
      }
      const warnings = [...rendered.warnings]
      let pdfPath = null
      if (args.pdf !== false) {
        const chrome = findChrome()
        if (chrome === null) {
          warnings.push('Chrome not found; HTML written, no PDF. Set CHROME_PATH or install Chrome/Chromium to enable PDF.')
        } else {
          pdfPath = target.replace(/\.html?$/i, '.pdf')
          const result = writePdf(chrome, target, pdfPath)
          if (!result.ok) {
            warnings.push(`PDF failed: ${result.error}`)
            pdfPath = null
          } else {
            const pages = pdfPageCount(readFileSync(pdfPath))
            if (pages !== null && pages > 1) {
              warnings.push(`the handoff rendered ${pages} pages but a handoff is one A4 page: this input is over budget. Trim tldr/changed/evidence/decisions/risks items or shorten them, then render again.`)
            }
          }
        }
      }
      const rel = relative(cwd, target)
      const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      return Promise.resolve({
        ok: true,
        path: target,
        ...(pdfPath === null ? {} : { pdf: pdfPath }),
        bytes: statSync(target).size,
        ...(outside ? { outsideWorkspace: true } : {}),
        warnings,
      })
    },
  })
}

export const name = 'handoff'
export const inject = ['tools']

/** Register the tool. */
export function apply(ctx) {
  ctx.tools.register(handoffTool(defineTool))
}
