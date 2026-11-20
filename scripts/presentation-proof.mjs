#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the presentation plugin before anyone claims a deck works: the renderer
 *   contract (one standalone file, five themes, fragments, print), the negative
 *   controls that must be refused, and the document as a browser actually shows
 *   it — including inside the `iframe sandbox="allow-scripts"` frame the Sidebar
 *   document preview mounts, which is the only environment a reader opens.
 *
 * WHAT IT ASSERTS
 *   - the deck renders with no errors and holds every slide it was given;
 *   - the file needs no network: no `src=`, no `@import`, no `url(`, no http(s)
 *     reference, one classic inline script and no module script;
 *   - five themes render, each sets its own `data-theme` and a different accent;
 *   - print is a slide per page: `@media print`, `@page` and `break-after:page`;
 *   - NEGATIVE CONTROLS: an empty spec is `ok:false` with an error and no file;
 *     a broken slide type is `degraded` with the slide index named; a donut with
 *     no positive value is an error, and the rest of the board still renders;
 *   - the board draws all four chart kinds with no external asset;
 *   - CHROMIUM: no console error, arrows change the slide, a fragment appears on
 *     the first advance and the slide changes on the second, `o` opens the
 *     overview, `n` opens the notes, print media keeps every slide visible;
 *   - the same deck runs inside `iframe sandbox="allow-scripts"` (opaque origin):
 *     a script still runs, no storage and no network are needed.
 *
 * INPUTS
 *   --out <dir>     artifact directory (default reports/presenter-proof)
 *   --json          print a machine-readable summary instead of the table
 *   --no-browser    renderer checks only (a control for a machine without Chromium)
 *
 * OUTPUTS
 *   One line per check, then a PASS/FAIL summary; exit 0 when every check passed,
 *   1 when one failed. Screenshots and the rendered HTML stay in <out>.
 *
 * COVERS (one case, several requirements — the batch rule of the case library):
 *   REQ-155 preset presenter, REQ-156 presentation tool, REQ-157 dashboard tool,
 *   REQ-158 role tool surface, REQ-159 this proof, REQ-160 the prefix-caching deck,
 *   REQ-161 packaging gates, REQ-162 second-server proof, REQ-163 offline document.
 *   A case protects the behaviour; `REQ-160` is its primary requirement.
 *
 * NEGATIVE CONTROL
 *   CASE_NEGATIVE_CONTROL=before-axis-fix replays the pre-fix chart gutter (a constant
 *   62 px) so the axis-fit check fails and the process exits 1: the case library needs a
 *   measured red before a green counts as verification.
 *
 * KEYWORDS
 *   presentation, deck, dashboard, renderer, proof, playwright, print, sandbox.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderBoard } from '../plugins/presentation/render-board.mjs'
import { renderDeck, THEMES } from '../plugins/presentation/render-deck.mjs'
import { chartSvg } from '../plugins/presentation/charts.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name, fallback) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback
}
const OUT = resolve(value('--out', join(KIT, 'reports', 'presenter-proof')))
const JSON_ONLY = argv.includes('--json')
const NO_BROWSER = argv.includes('--no-browser')
const CSS = readFileSync(join(KIT, 'plugins', 'presentation', 'theme.css'), 'utf8')
/** The chart gutter the renderer used before 2026-11-20: a constant that clipped a long tick. */
const PRE_FIX_GUTTER = 62
/** A negative control replays the old defect on demand, so the check can be seen to fail. */
const CONTROL = process.env.CASE_NEGATIVE_CONTROL ?? ''

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
  if (!JSON_ONLY) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** A deck that exercises every slide type and every block the renderer knows. */
const DECK = {
  theme: 'ember',
  title: 'Проверка рендера презентации',
  lang: 'ru',
  foot: 'dsh-kit',
  slides: [
    {
      type: 'cover', kicker: 'проверка', title: 'Колода, собранная из спецификации',
      lede: 'Одна мысль на кадр, движение только там, где оно показывает изменение.',
      meta: ['2026-11-20', 'dsh-kit', 'presentation 0.2.0'],
    },
    {
      type: 'section', kicker: 'часть первая', title: 'Как устроен рендер',
      lede: 'Спецификация → один автономный документ.',
    },
    {
      kicker: 'карточки', title: 'Три карточки одного уровня',
      cards: [
        { title: 'Токены', text: 'Палитра, типографика и шаги сетки живут в одном слое.', color: 'info' },
        { title: 'Компоненты', text: 'Карточка, показатель, шаги, сравнение, график.', color: 'ok' },
        { title: 'Плеер', text: 'Клавиатура, фрагменты, обзор, заметки, печать.', color: 'violet' },
      ],
    },
    {
      kicker: 'показатели', title: 'Числа оживают на входе',
      kpis: [
        { value: '162', label: 'закрытых задач', color: 'ok' },
        { value: '93,8 %', label: 'промпта из кэша' },
        { value: '5', label: 'тем на выбор', color: 'info' },
      ],
      callout: { text: 'Число в плитке считается от нуля — читатель видит масштаб, а не только итог.', tone: 'info' },
    },
    {
      type: 'steps', kicker: 'порядок', title: 'Шаги открываются по одному',
      steps: [
        { title: 'Сначала показать состояние', text: 'Читатель должен увидеть, что было.' },
        { title: 'Потом — изменение', text: 'Один шаг на одно изменение.' },
        { title: 'Затем — вывод', text: 'Итог появляется последним.' },
      ],
    },
    {
      type: 'compare', kicker: 'сравнение', title: 'Было и стало',
      compare: {
        left: { head: 'было', title: 'Всё заново', text: 'Каждый запрос перечитывает тот же текст с нуля.', list: ['дорого', 'медленно'] },
        right: { head: 'стало', title: 'Из памяти', text: 'Готовая часть берётся из кэша, считается только хвост.', list: ['дешевле', 'быстрее'] },
      },
    },
    {
      type: 'chart', kicker: 'график', title: 'Столбики показывают разницу',
      chart: {
        kind: 'bar',
        data: [
          { label: 'без кэша', value: 100, tone: 'danger' },
          { label: 'с кэшем', value: 18, tone: 'ok' },
        ],
        caption: 'Время первого токена, условные единицы',
      },
    },
    {
      type: 'visual', kicker: 'схема', title: 'Схема остаётся схемой',
      visual: {
        svg: '<svg viewBox="0 0 720 260" role="img" aria-label="Префикс и хвост"><rect x="20" y="80" width="380" height="100" rx="12" fill="none" stroke="var(--accent)" stroke-width="2"/><rect x="420" y="80" width="180" height="100" rx="12" fill="none" stroke="var(--info)" stroke-width="2" stroke-dasharray="6 6"/><text x="210" y="140" text-anchor="middle" fill="var(--ink)" font-size="22">кэшируемый префикс</text><text x="510" y="140" text-anchor="middle" fill="var(--info)" font-size="18">хвост</text></svg>',
        caption: 'Слева — то, что считается один раз; справа — то, что каждый раз новое.',
      },
    },
    {
      kicker: 'списки', title: 'Таблица, цитата и мелочи',
      table: { header: ['слой', 'что делает'], rows: [['рендер', 'одна страница без сети'], ['темы', 'пять наборов токенов'], ['печать', 'слайд на страницу']] },
      quote: { text: 'Презентация — это порядок кадров, а не набор фактов.', by: 'правило рендера' },
    },
    {
      type: 'raw', title: 'Сырой слайд',
      html: '<div class="wrap" style="justify-content:center"><div class="kicker">raw</div><h2 class="title title--lg">Собственная разметка и движение</h2><p class="lede">Слайд raw принимает любой HTML, CSS и классический скрипт — выход для того, чего нет в спецификации.</p></div>',
    },
  ],
}

/** A board that exercises tiles, every chart kind and a status list. */
const BOARD = {
  theme: 'graphite',
  kicker: 'dsh-kit',
  title: 'Сводка проекта',
  subtitle: 'Показатели, графики и открытые вопросы на одном экране.',
  meta: ['обновлено 20.11.2026', 'источник: state/views'],
  tiles: [
    { value: '162', label: 'задач закрыто', delta: '+6', tone: 'ok' },
    { value: '154', label: 'требований', delta: '+9', tone: 'info' },
    { value: '76', label: 'проверок', tone: 'violet' },
    { value: '3', label: 'открытых задачи', delta: '-2', tone: 'danger', note: 'доска в работе' },
  ],
  charts: [
    { kind: 'bar', title: 'Задачи по статусам', unit: 'шт', data: [{ label: 'done', value: 162 }, { label: 'review', value: 4 }, { label: 'open', value: 3 }, { label: 'cancel', value: 82 }], foot: 'из state/views/index.json' },
    { kind: 'line', title: 'Требования по неделям', unit: 'шт', data: [{ label: '1', value: 98 }, { label: '2', value: 112 }, { label: '3', value: 121 }, { label: '4', value: 154 }], foot: 'прирост за ноябрь' },
    { kind: 'donut', title: 'Доля проверенных требований', data: [{ label: 'проверено', value: 71, tone: 'ok' }, { label: 'в работе', value: 83, tone: 'info' }], centerLabel: 'из 154' },
    { kind: 'sparkline', title: 'Активность по дням', data: [4, 9, 7, 12, 10, 18, 14, 20], foot: 'число задач за день' },
  ],
  lists: [
    { title: 'открытые риски', items: [{ label: 'нет проверки на живом сервере', value: 'high', tone: 'danger' }, { label: 'документация отстаёт', value: 'med', tone: 'warn' }, { label: 'шум в консоли MCP', value: 'low', tone: 'ok' }] },
    { title: 'роли', items: [{ label: 'orchestrator', value: 'активен', tone: 'ok' }, { label: 'presenter', value: 'новый', tone: 'info' }, { label: 'backend', value: 'активен', tone: 'ok' }] },
  ],
  foot: ['собрано 2026-11-20', 'dsh-kit · presentation 0.2.0'],
}

/** Drops comments so a prose mention of `url()` is not read as a stylesheet URL. */
function withoutComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Chars the document must not carry: every one of them would be a network call. */
const EXTERNAL = [
  ['script src', /<script[^>]+\bsrc=/i],
  ['link href', /<link[^>]+\bhref=/i],
  ['@import', /@import\s/i],
  ['url(', /url\(/i],
  ['http(s) reference', /https?:\/\//i],
  ['module script', /<script[^>]*type=["']module["']/i],
]

/** Renders everything, writes the artifacts and returns the file paths. */
function renderArtifacts() {
  mkdirSync(OUT, { recursive: true })
  const files = {}
  const deck = renderDeck(DECK, { css: CSS })
  check('deck renders without errors', deck.errors.length === 0, deck.errors.join('; ') || `${deck.slides} slides`)
  check('deck holds every slide', deck.slides === DECK.slides.length, `${deck.slides}/${DECK.slides.length}`)
  check('deck has no warnings', deck.warnings.length === 0, deck.warnings.join('; '))
  if (deck.html !== null) {
    files.deck = join(OUT, 'deck.html')
    writeFileSync(files.deck, deck.html)
    const deckBody = withoutComments(deck.html)
    for (const [name, pattern] of EXTERNAL) {
      check(`deck is self-contained: no ${name}`, pattern.test(deckBody) === false)
    }
    check('deck carries one inline script', (deck.html.match(/<script/gi) ?? []).length === 1)
    check('deck declares a theme on the root', /<html[^>]+data-theme="ember"/.test(deck.html))
    check('deck names every slide for the overview', (deck.html.match(/data-number="/g) ?? []).length === deck.slides)
    check('deck reaches the print rules', /@media print/.test(deck.html) && /break-after:page/.test(deck.html) && /@page/.test(deck.html))
    check('deck exposes fragments for the steps', /data-frag/.test(deck.html))
  }

  // Five themes: each one renders, keeps its own id, and defines its own accent.
  // The accent is read from the STYLE SHEET, so a theme that forgot to override a
  // token is caught instead of merely being counted.
  const accents = new Map()
  for (const theme of THEMES) {
    const one = renderDeck({ ...DECK, theme }, { css: CSS })
    const ok = one.errors.length === 0 && one.theme === theme && one.html !== null && one.html.includes(`data-theme="${theme}"`)
    check(`theme ${theme} renders`, ok)
    const block = theme === 'ember'
      ? /:root, \[data-theme="ember"\]\{([\s\S]*?)\n\}/.exec(CSS)
      : new RegExp(`\\[data-theme="${theme}"\\]\\{([\\s\\S]*?)\\n\\}`).exec(CSS)
    const accent = block === null ? null : /--accent:([^;]+);/.exec(block[1])
    if (accent !== null) accents.set(theme, accent[1].trim())
  }
  check('five themes define five different accents', accents.size === 5 && new Set(accents.values()).size === 5, [...accents].map(([name, value]) => `${name}=${value}`).join(' '))

  // A visual slide whose SVG is built up ONE CELL AT A TIME: the fragment rule
  // inside an SVG must not clobber each group's own transform, so this fixture is
  // the fail-capable half of the cache-rack story.
  const cells = [0, 1, 2].map((index) =>
    `<g data-frag="dim" transform="translate(${40 + index * 180},60)"><rect width="140" height="90" rx="12" fill="none" stroke="var(--accent)"/><text x="70" y="56" text-anchor="middle" fill="var(--ink)" font-size="24">${index + 1}</text></g>`).join('')
  // The control replays the pre-fix rule (a CSS transform on an SVG group), so the
  // coordinate check below can be seen to fail.
  const svgCss = CONTROL === 'before-svg-fragment-fix' ? `${CSS}\nsvg [data-frag]{transform:translateY(10px) !important}` : CSS
  const svgDeck = renderDeck({ theme: 'ember', title: 'Кэш по ячейкам', slides: [
    { type: 'cover', title: 'Кэш по ячейкам' },
    { type: 'visual', title: 'Кэш заполняется по ячейкам', visual: { svg: `<svg viewBox="0 0 620 220">${cells}</svg>`, caption: 'каждая ячейка — пара ключ-значение' } },
  ] }, { css: svgCss })
  check('svg fragments render', svgDeck.errors.length === 0 && (svgDeck.html.match(/<g data-frag/g) ?? []).length === 3, `${(svgDeck.html.match(/<g data-frag/g) ?? []).length} groups`)
  if (svgDeck.html !== null) {
    files.svgFragments = join(OUT, 'svg-fragments.html')
    writeFileSync(files.svgFragments, svgDeck.html)
  }

  const board = renderBoard(BOARD, { css: CSS })
  check('board renders without errors', board.errors.length === 0, board.errors.join('; ') || `${board.tiles} tiles, ${board.charts} charts`)
  check('board draws every chart', board.charts === BOARD.charts.length, `${board.charts}/${BOARD.charts.length}`)
  if (board.html !== null) {
    files.board = join(OUT, 'board.html')
    writeFileSync(files.board, board.html)
    const boardBody = withoutComments(board.html)
    for (const [name, pattern] of EXTERNAL) {
      check(`board is self-contained: no ${name}`, pattern.test(boardBody) === false)
    }
    for (const kind of ['bar', 'line', 'donut', 'sparkline']) {
      check(`board draws a ${kind} chart`, new RegExp(`chart-card`).test(board.html) && new RegExp(kind).test(BOARD.charts.map((c) => c.kind).join(',')))
    }
    check('board reaches the print rules', /@media print/.test(board.html))
  }

  // NEGATIVE CONTROLS: the renderer refuses instead of guessing.
  const injected = renderDeck({ slides: [{ title: '<script>alert(1)</script> & "q"', lede: '<b>x</b> **b**' }] }, { css: CSS })
  check('positive: spec text is escaped, not executed',
    injected.html !== null && injected.html.includes('&lt;script&gt;') && injected.html.includes('&amp;') && !/<script>alert\(1\)/.test(injected.html))
  const empty = renderDeck({ slides: [] }, { css: CSS })
  check('negative: a deck with no slides is refused', empty.html === null && empty.errors.length > 0, empty.errors[0] ?? '')
  const brokenType = renderDeck({ slides: [{ type: 'nonsense', title: 'x' }] }, { css: CSS })
  check('negative: an unknown slide type is named and the document is degraded', brokenType.errors.some((error) => /unknown type/.test(error)), brokenType.errors[0] ?? '')
  const noTitle = renderDeck({ slides: [{ kicker: 'k' }] }, { css: CSS })
  check('negative: a slide without a title is reported', noTitle.errors.some((error) => /no title/.test(error)))
  const badDonut = chartSvg({ kind: 'donut', data: [] })
  check('negative: an empty donut is an error, not an empty circle', badDonut.svg === '' && badDonut.errors.length > 0, badDonut.errors[0] ?? '')
  const badBoard = renderBoard({ theme: 'nope', tiles: [] }, { css: CSS })
  check('negative: a board with nothing to show is refused', badBoard.html === null && badBoard.errors.length > 0, badBoard.errors[0] ?? '')
  const unknownTheme = renderDeck({ ...DECK, theme: 'neon' }, { css: CSS })
  check('negative: an unknown theme falls back with a warning', unknownTheme.theme === 'ember' && unknownTheme.warnings.length > 0, unknownTheme.warnings[0] ?? '')
  return files
}

/** Loads playwright-core from the kit's pinned .tools, and a browser to drive. */
async function browser() {
  const require = createRequire(join(KIT, '.tools', 'index.js'))
  const { chromium } = require('playwright-core')
  try {
    return await chromium.launch()
  } catch (error) {
    // A machine whose Playwright cache lacks the pinned build still has Chrome.
    return await chromium.launch({ channel: 'chrome' })
  }
}

/** Reads the visible deck state: the current slide number and the fragment count. */
const DECK_STATE = `(() => {
  const slides = Array.from(document.querySelectorAll('.slide'))
  const current = slides.findIndex((slide) => slide.classList.contains('is-current'))
  return {
    slides: slides.length,
    current,
    hash: location.hash,
    revealed: document.querySelectorAll('[data-frag].is-here').length,
    fragments: document.querySelectorAll('[data-frag]').length,
    overviewOpen: document.body.classList.contains('is-overview'),
    overviewItems: document.querySelectorAll('.deck-overview__item').length,
    notesOpen: document.body.classList.contains('is-notes'),
    notesText: (document.querySelector('.deck-notes') || {}).textContent || '',
    animated: document.querySelectorAll('[data-anim]').length,
  }
})()`

/** Drives the rendered deck in Chromium and screenshots every slide. */
async function proveInBrowser(files) {
  if (files.deck === undefined) return
  const instance = await browser()
  const context = await instance.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/.test(message.text())) errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error.message)))

  await page.goto(pathToFileURL(files.deck).href)
  await page.waitForSelector('.slide.is-current')
  await page.waitForTimeout(450)
  let state = await page.evaluate(DECK_STATE)
  check('browser: the deck opens on the first slide', state.current === 0 && state.slides === DECK.slides.length, `${state.current + 1}/${state.slides}`)
  check('browser: the entrance animation is wired', state.animated > 10, `${state.animated} animated elements`)

  // A screenshot of a fragment slide must show the slide as fully revealed: the
  // frame is the deliverable, so the artifact reveals every fragment first.
  const shots = []
  for (let index = 0; index < state.slides; index += 1) {
    await page.evaluate((n) => { window.location.hash = `#${n + 1}` }, index)
    await page.waitForTimeout(420)
    const fragments = await page.evaluate(() => document.querySelectorAll('.slide.is-current [data-frag]').length)
    for (let step = 0; step < fragments; step += 1) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(180)
    }
    const shot = join(OUT, `deck-${String(index + 1).padStart(2, '0')}.png`)
    await page.screenshot({ path: shot })
    shots.push(shot)
  }
  check('browser: every slide renders a screenshot', shots.length === state.slides, `${shots.length} PNG`)

  await page.evaluate(() => { window.location.hash = '#1' })
  await page.waitForTimeout(200)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(260)
  state = await page.evaluate(DECK_STATE)
  check('browser: the right arrow changes the slide', state.current === 1, `slide ${state.current + 1}, hash ${state.hash}`)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(260)
  state = await page.evaluate(DECK_STATE)
  check('browser: the left arrow goes back', state.current === 0)

  // Fragments: the steps slide reveals one step per advance, and only then moves on.
  await page.evaluate(() => { window.location.hash = '#5' })
  await page.waitForTimeout(300)
  const before = await page.evaluate(DECK_STATE)
  check('browser: the steps slide starts with every fragment hidden', before.revealed === 0 && before.fragments >= 3, `${before.revealed}/${before.fragments}`)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(240)
  const first = await page.evaluate(DECK_STATE)
  check('browser: the first advance reveals one fragment and stays on the slide', first.revealed === 1 && first.current === 4, `revealed ${first.revealed}, slide ${first.current + 1}`)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(240)
  const second = await page.evaluate(DECK_STATE)
  check('browser: the next advance reveals the next fragment', second.revealed === 2 && second.current === 4)

  await page.keyboard.press('o')
  await page.waitForTimeout(200)
  state = await page.evaluate(DECK_STATE)
  check('browser: O opens the overview with one item per slide', state.overviewOpen && state.overviewItems === state.slides, `${state.overviewItems} items`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  await page.keyboard.press('n')
  await page.waitForTimeout(150)
  state = await page.evaluate(DECK_STATE)
  check('browser: N opens the speaker notes', state.notesOpen && state.notesText.includes('Заметки'))
  await page.keyboard.press('Escape')

  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(150)
  const printed = await page.evaluate(() => Array.from(document.querySelectorAll('.slide')).map((slide) => {
    const style = getComputedStyle(slide)
    return { visible: style.visibility, opacity: style.opacity, offsetTop: slide.offsetTop }
  }))
  check('browser: print keeps every slide visible', printed.every((row) => row.visible === 'visible' && Number(row.opacity) === 1), `${printed.length} slides`)
  const distinct = new Set(printed.map((row) => row.offsetTop))
  check('browser: print stacks the slides instead of overlapping', distinct.size === printed.length, `${distinct.size} distinct offsets`)
  await page.emulateMedia({ media: 'screen' })

  check('browser: no console error on the deck', errors.length === 0, errors.slice(0, 3).join(' | '))
  await page.close()

  // The cache-rack mechanism: inside one SVG, each group reveals on its own
  // advance and keeps its own coordinates. A CSS transform on the fragment would
  // collapse every group onto the origin, which is exactly what this catches.
  if (files.svgFragments !== undefined) {
    const svgPage = await context.newPage()
    const svgErrors = []
    svgPage.on('pageerror', (error) => svgErrors.push(String(error.message)))
    await svgPage.goto(pathToFileURL(files.svgFragments).href)
    await svgPage.waitForSelector('.slide.is-current')
    await svgPage.evaluate(() => { window.location.hash = '#2' })
    await svgPage.waitForTimeout(320)
    const cellsAt = () => svgPage.evaluate(() => Array.from(document.querySelectorAll('.slide.is-current [data-frag]')).map((group) => ({
      x: Math.round(group.getBoundingClientRect().x),
      here: group.classList.contains('is-here'),
      opacity: Number(getComputedStyle(group).opacity),
    })))
    const before = await cellsAt()
    await svgPage.keyboard.press('ArrowRight')
    await svgPage.waitForTimeout(380)
    const after = await cellsAt()
    check('browser: an SVG fragment reveals one group at a time', before.every((cell) => cell.here === false) && after.filter((cell) => cell.here).length === 1, `${after.filter((cell) => cell.here).length} of ${after.length} revealed`)
    check('browser: an SVG fragment keeps its own coordinates', new Set(after.map((cell) => cell.x)).size === after.length, after.map((cell) => cell.x).join(', '))
    // The transition ends at 1; a mid-flight read is not a defect, so the check
    // asserts "visibly revealed" (≥ .9) against the hidden groups (≤ .5).
    const shown = after.filter((cell) => cell.here)
    const hidden = after.filter((cell) => !cell.here)
    check('browser: the revealed SVG group is visible and the rest stays dim', shown.every((cell) => cell.opacity >= 0.9) && hidden.every((cell) => cell.opacity <= 0.5), `shown ${shown.map((cell) => cell.opacity).join(',')} · hidden ${hidden.map((cell) => cell.opacity).join(',')}`)
    check('browser: no page error on the SVG-fragment deck', svgErrors.length === 0, svgErrors.slice(0, 2).join(' | '))
    await svgPage.close()
  }

  // The real reader path: the Sidebar document preview mounts the bytes in a
  // sandboxed iframe, so the deck must work with an opaque origin and no network.
  const sandbox = await context.newPage()
  const sandboxErrors = []
  sandbox.on('console', (message) => { if (message.type() === 'error') sandboxErrors.push(message.text()) })
  sandbox.on('pageerror', (error) => sandboxErrors.push(String(error.message)))
  const html = readFileSync(files.deck, 'utf8')
  await sandbox.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="preview" sandbox="allow-scripts" style="border:0;width:1600px;height:900px" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></body>`)
  await sandbox.waitForTimeout(500)
  const frame = sandbox.frames().find((candidate) => candidate !== sandbox.mainFrame())
  check('sandbox: the preview frame mounts', frame !== undefined)
  if (frame !== undefined) {
    const inside = await frame.evaluate(() => ({
      slides: document.querySelectorAll('.slide').length,
      current: document.querySelectorAll('.slide.is-current').length,
      scripts: document.querySelectorAll('script').length,
      origin: (() => { try { return window.localStorage.length } catch (error) { return 'opaque' } })(),
    }))
    check('sandbox: the deck renders inside an opaque-origin frame', inside.slides === DECK.slides.length && inside.current === 1, `${inside.slides} slides, ${inside.current} current`)
    check('sandbox: the opaque origin has no storage, and the deck does not need it', inside.origin === 'opaque' || inside.origin === 0, String(inside.origin))
    const current = () => frame.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex((slide) => slide.classList.contains('is-current')))
    await frame.locator('.slide.is-current').click({ position: { x: 600, y: 200 } })
    await sandbox.waitForTimeout(260)
    const afterClick = await current()
    check('sandbox: a click on the slide advances it', afterClick === 1, `slide ${afterClick + 1}`)
    await sandbox.keyboard.press('ArrowRight')
    await sandbox.waitForTimeout(260)
    const afterKey = await current()
    check('sandbox: the keyboard works after the click that focuses the frame', afterKey === 2, `slide ${afterKey + 1}`)
  }
  check('sandbox: no console error inside the frame', sandboxErrors.length === 0, sandboxErrors.slice(0, 2).join(' | '))
  await sandbox.close()

  if (files.board !== undefined) {
    const boardPage = await context.newPage()
    const boardErrors = []
    boardPage.on('console', (message) => { if (message.type() === 'error' && !/favicon/.test(message.text())) boardErrors.push(message.text()) })
    boardPage.on('pageerror', (error) => boardErrors.push(String(error.message)))
    await boardPage.goto(pathToFileURL(files.board).href)
    await boardPage.waitForSelector('.board')
    await boardPage.waitForTimeout(900)
    const boardState = await boardPage.evaluate(() => ({
      live: document.querySelector('.board').classList.contains('is-live'),
      tiles: document.querySelectorAll('.tile').length,
      charts: document.querySelectorAll('.chart-card svg').length,
      lists: document.querySelectorAll('.list-card').length,
      counted: Array.from(document.querySelectorAll('[data-count]')).map((node) => node.textContent),
    }))
    check('browser: the board goes live and counts its tiles', boardState.live && boardState.counted.length > 0, boardState.counted.slice(0, 4).join(' / '))
    check('browser: the board shows every tile, chart and list', boardState.tiles === BOARD.tiles.length && boardState.charts === BOARD.charts.length && boardState.lists === BOARD.lists.length, `${boardState.tiles} tiles, ${boardState.charts} charts, ${boardState.lists} lists`)
    check('browser: no console error on the board', boardErrors.length === 0, boardErrors.slice(0, 2).join(' | '))
    await boardPage.screenshot({ path: join(OUT, 'board.png'), fullPage: true })
    await boardPage.close()
  }
  await context.close()
  await instance.close()
  void page
}

/**
 * The axis-fit check: every y-axis tick must start inside the viewBox. The renderer
 * solves its left gutter from the widest label; the control replays the old constant,
 * which is how this check was proved able to fail (a deck plotting `2 000 мс` printed
 * `000 мс`).
 */
function chartAxisFits() {
  const chart = chartSvg({ kind: 'bar', unit: 'мс', data: [{ label: 'без кэша', value: 1193 }, { label: 'с кэшем', value: 46 }], width: 1240, height: 400 })
  const ticks = [...chart.svg.matchAll(/<text x="([0-9.]+)" y="[0-9.]+" text-anchor="end"[^>]*>([^<]*)</g)]
  if (ticks.length === 0) {
    check('chart: the axis prints tick labels at all', false, 'no end-anchored label in the SVG')
    return
  }
  const measured = Number(ticks[0][1]) + 12
  const gutter = CONTROL === 'before-axis-fix' ? PRE_FIX_GUTTER : measured
  // 8 px per character at the 13 px mono size; the label ends 12 px left of the axis.
  const starts = ticks.map(([, , label]) => gutter - 12 - label.length * 8)
  const leftmost = Math.min(...starts)
  check('chart: every axis tick fits inside the viewBox', leftmost >= 0, `gutter ${gutter}px, leftmost label starts at ${leftmost}px`)
}

const files = renderArtifacts()
chartAxisFits()
if (!NO_BROWSER) {
  try {
    await proveInBrowser(files)
  } catch (error) {
    check('browser: the run completed', false, error.message)
  }
} else {
  check('browser: skipped by --no-browser', true)
}

const failed = checks.filter((entry) => !entry.ok)
if (JSON_ONLY) {
  console.log(JSON.stringify({ ok: failed.length === 0, total: checks.length, failed: failed.length, checks }, null, 2))
} else {
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${checks.length - failed.length}/${checks.length} checks, artifacts in ${OUT}`)
}
process.exit(failed.length === 0 ? 0 : 1)
