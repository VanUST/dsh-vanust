/*
PROOF: the three-document rule, the state ban and the review-date rule
Behavior: scripts/check-documentation.mjs --documents-only --root <fixture> passes a legal set
  (docs/GUIDE.md, docs/ARCHITECTURE.md, docs/TERMINOLOGY.md with a review date; docs/cases and
  docs/analysis ignored) and refuses a fourth markdown file, a
  version, a task number, a counter, a missing review date, a date older than DOCUMENT_MAX_AGE_DAYS
  and a date older than a file the document references.
Fails when: a fourth document passes, state passes, a dateless or stale document passes, or the
  legal set is refused.
Production path: scripts/check-documentation.mjs (checkDocuments, the --documents-only fixture mode).
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-documentation.mjs')
const day = 86400000
const iso = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString().slice(0, 10)

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'documents-fixture-'))
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  return root
}
function run(root) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--documents-only', '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}
const documentText = (body = '', date = iso(10)) => `# Документ\n\n${body === '' ? '' : body + '\n\n'}Дата проверки: ${date}\n`
const legalFiles = () => ({
  'docs/GUIDE.md': documentText('Как запустить: словами.'),
  'docs/ARCHITECTURE.md': documentText('Как устроено.'),
  'docs/TERMINOLOGY.md': documentText('Словарь.'),
  'docs/cases/example.md': '# кейс',
  'docs/analysis/initiative.md': '# данные',
})
const withGuide = (text) => ({ ...legalFiles(), 'docs/GUIDE.md': text })

test('the legal set passes', () => {
  const result = run(fixture(legalFiles()))
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /documentation ok/)
})

test('a markdown file outside the three documents is refused', () => {
  const files = legalFiles()
  files['docs/NOTES.md'] = documentText('лишний документ')
  const result = run(fixture(files))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /undeclared_document docs\/NOTES\.md/)
})

test('a version in a document is refused', () => {
  const result = run(fixture(withGuide(documentText('Работает на версии 0.2.2-rc.3.'))))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /state_version docs\/GUIDE\.md/)
})

test('a task number in a document is refused', () => {
  const result = run(fixture(withGuide(documentText('Сделано в TASK-419.'))))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /state_task_id docs\/GUIDE\.md/)
})

test('a counter in a document is refused', () => {
  const result = run(fixture(withGuide(documentText('Готово 3 из 10 инициатив.'))))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /state_counter docs\/GUIDE\.md/)
})

test('a document without a review date is refused', () => {
  const result = run(fixture(withGuide('# Документ\n\nБез даты.\n')))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /document_date_missing docs\/GUIDE\.md/)
})

test('a review date older than the allowed age is refused', () => {
  const result = run(fixture(withGuide(documentText('Старый документ.', iso(200)))))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /document_stale docs\/GUIDE\.md/)
})

test('the harness pin named by the procedure is not state, any other version is', () => {
  const pinned = run(fixture(withGuide(documentText('Пин: \`@deepseek-ai/dsh@9.9.9\`.'))))
  assert.equal(pinned.code, 0, pinned.stderr)
  const prose = run(fixture(withGuide(documentText('Харнесс закреплён на dsh 9.9.9.'))))
  assert.equal(prose.code, 1)
  assert.match(prose.stderr, /state_version docs\/GUIDE\.md/)
})

test('a review date older than the file the document references is refused', () => {
  const files = legalFiles()
  files['docs/GUIDE.md'] = documentText('Запуск: \`scripts/x.mjs\`.', iso(30))
  files['scripts/x.mjs'] = '// changed after the review\n'
  const root = fixture(files)
  const changed = new Date(Date.now() - 5 * day)
  utimesSync(join(root, 'scripts/x.mjs'), changed, changed)
  const result = run(root)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /document_stale docs\/GUIDE\.md/)
  assert.match(result.stderr, /scripts\/x\.mjs/)
})
