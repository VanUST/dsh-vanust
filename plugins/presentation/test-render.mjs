// PURPOSE: Self-test for the presentation renderer — proves the deck it produces is
//          self-contained and that a bad spec is reported instead of throwing.
// INPUTS: none. Run: node plugins/presentation/test-render.mjs
// OUTPUTS: one JSON summary on stdout; exit 0 when every case holds, 1 otherwise.
// KEYWORDS: presentation, renderer, test, self-check, html, spec.
import { renderDeck } from './render.mjs'

const cases = []
const check = (name, condition, detail) => cases.push({ name, ok: Boolean(condition), detail })

const spec = {
  theme: 'graphite',
  title: 'Проверка рендера',
  slides: [
    {
      type: 'cover',
      kicker: 'Тест',
      title: 'Титул с ==акцентом==',
      lede: 'Вводная строка со **жирным** словом.'
    },
    {
      kicker: 'Слайд 2',
      title: 'Блоки',
      cards: [{ title: 'Карточка', text: 'Текст', list: ['раз', 'два'] }],
      kpis: [{ value: '5', label: 'тем', note: 'токены' }],
      table: { header: ['A', 'B'], rows: [['ключ', 'значение']] },
      timeline: [{ title: 'Шаг', text: 'текст' }],
      quote: { text: 'Цитата', by: 'автор' },
      chips: { label: 'Чипы', items: ['один', 'два'] },
      callout: 'Оговорка'
    }
  ]
}

const good = renderDeck(spec)
check('spec renders', good.html !== null)
check('theme honoured', good.theme === 'graphite', good.theme)
check('slide count', good.slides === 2, String(good.slides))
check('no errors', good.errors.length === 0, good.errors.join('; '))
check('doctype', good.html.startsWith('<!doctype html>'), good.html.slice(0, 20))
check('inline css', good.html.includes('.card__title') && !good.html.includes('<link rel="stylesheet" href=".'))
check('inline classic script', good.html.includes('function fit()') && !good.html.includes('type="module"'))
check('both slides present', (good.html.match(/<section class="slide/g) || []).length === 2)
check('bold markup applied', good.html.includes('<b>жирным</b>'))
check('highlight markup applied', good.html.includes('<span class="hl">акцентом</span>'))
check('page numbers', good.html.includes('1<span>/2</span>') && good.html.includes('2<span>/2</span>'))
check('escaping', renderDeck({ slides: [{ title: '<script>x</script>' }] }).html.includes('&lt;script&gt;'))

const badType = renderDeck({ slides: [{ type: 'chart', title: 'A' }, { title: 'B' }] })
check('unknown type reported', badType.errors.some((e) => e.includes('slide 1') && e.includes('chart')), badType.errors.join('; '))
check('invalid-type slide still renders as content', (badType.html.match(/<section class="slide/g) || []).length === 2)

const badEntry = renderDeck({ slides: [null, { title: 'B' }] })
check('non-object slide reported', badEntry.errors.some((e) => e.includes('slide 1')), badEntry.errors.join('; '))
check('non-object slide skipped', (badEntry.html.match(/<section class="slide/g) || []).length === 1)

const badTheme = renderDeck({ theme: 'neon', slides: [{ title: 'A' }] })
check('unknown theme warned', badTheme.warnings.some((w) => w.includes('neon')) && badTheme.theme === 'ember')

check('non-object spec', renderDeck(null).html === null)
check('missing slides', renderDeck({ title: 'x' }).html === null)
check('empty slides', renderDeck({ slides: [] }).html === null)

const failed = cases.filter((c) => !c.ok)
console.log(JSON.stringify({
  unit: 'presentation-render',
  total: cases.length,
  failed: failed.length,
  cases: cases.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail }))
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
