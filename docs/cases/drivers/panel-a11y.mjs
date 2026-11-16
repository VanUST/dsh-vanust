#!/usr/bin/env node
/**
 * PROOF DRIVER: the accessibility check a UX/UI role performs by hand, as a measurable case.
 *
 * Loads the fixture page in the kit's pinned Chromium, injects the pinned axe-core, and writes a
 * CASE_SUMMARY with the violation counts, the page hash and its artifacts (the axe report and a
 * screenshot). It never decides pass/fail: the case's declared checks do.
 *
 * Negative control: with CASE_NEGATIVE_CONTROL=break-a11y it appends an unnamed button before the
 * scan and exits 1 when the scan actually reports a serious violation, which is what proves the
 * check can fail.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const require = createRequire(import.meta.url)
const summaryPath = process.env.CASE_SUMMARY
const artifactsDir = process.env.CASE_ARTIFACTS
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const fixture = join(root, 'docs', 'cases', 'fixtures', 'a11y-page.html')

function chromiumPath() {
  if (typeof process.env.CASE_CHROMIUM === 'string' && process.env.CASE_CHROMIUM !== '') return process.env.CASE_CHROMIUM
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(cache)) return null
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((left, right) => Number(right.split('-')[1]) - Number(left.split('-')[1]))
  for (const build of builds) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const candidate = join(cache, build, layout)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function writeSummary(value) {
  if (summaryPath) writeFileSync(summaryPath, JSON.stringify(value, null, 2))
}

const executablePath = chromiumPath()
if (executablePath === null) {
  writeSummary({ metrics: {}, hashes: {}, artifacts: [], notes: 'no Chromium build found under ~/.cache/ms-playwright' })
  console.error('panel-a11y: no Chromium build found; set CASE_CHROMIUM')
  process.exit(2)
}
if (!existsSync(fixture)) {
  writeSummary({ metrics: {}, hashes: {}, artifacts: [], notes: `fixture missing: ${fixture}` })
  console.error(`panel-a11y: fixture missing: ${fixture}`)
  process.exit(2)
}

const { chromium } = require(join(root, '.tools', 'node_modules', 'playwright-core'))
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`file://${fixture}`)
  if (control === 'break-a11y') {
    // A control that only works if the scan actually catches it: an empty button has no
    // accessible name, which axe reports as `button-name` (serious).
    await page.evaluate(() => {
      const button = document.createElement('button')
      button.id = 'unnamed-control'
      document.querySelector('main')?.appendChild(button)
    })
  }
  const axeSource = readFileSync(join(root, '.tools', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
  await page.addScriptTag({ content: axeSource })
  const results = await page.evaluate(async () => await globalThis.axe.run(document, { resultTypes: ['violations'] }))
  const violations = Array.isArray(results.violations) ? results.violations : []
  const serious = violations.filter((entry) => entry.impact === 'serious' || entry.impact === 'critical').length
  const artifacts = []
  if (artifactsDir) {
    writeFileSync(join(artifactsDir, 'axe.json'), `${JSON.stringify(violations, null, 2)}\n`)
    await page.screenshot({ path: join(artifactsDir, 'page.png') })
    artifacts.push('axe.json', 'page.png')
  }
  const pageHash = `sha256:${createHash('sha256').update(readFileSync(fixture)).digest('hex')}`
  writeSummary({
    metrics: { violations: violations.length, serious },
    hashes: { page: pageHash },
    artifacts,
    notes: violations.map((entry) => `${entry.id}: ${entry.help}`).join('\n').slice(0, 2000),
  })
  await browser.close()
  if (control === 'break-a11y') {
    // The control counts only when the check it breaks is actually observed failing.
    process.exit(serious > 0 ? 1 : 0)
  }
  process.exit(0)
} catch (error) {
  await browser.close().catch(() => {})
  writeSummary({ metrics: {}, hashes: {}, artifacts: [], notes: `driver error: ${error?.message ?? error}` })
  console.error(`panel-a11y: ${error?.message ?? error}`)
  process.exit(2)
}
