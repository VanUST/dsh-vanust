#!/usr/bin/env node
/**
 * PURPOSE
 *   FR14: every heading of the human-facing report template must be a DEFINED term. The template
 *   lives in the root policy (`plugins/orchestrator/orchestrator.mjs`); the glossary lives in
 *   `docs/TERMINOLOGY.md`. This check fails when one drifts from the other, so a new report
 *   section cannot ship without its word being defined first.
 *
 * WHAT IT CHECKS
 *   1. each template term appears in the glossary (case-insensitive, word boundary);
 *   2. each template term still appears in the root policy (the template did not change under
 *      the list);
 *   3. the glossary is not empty and names at least the seven template terms.
 *
 * USAGE
 *   node scripts/check-glossary.mjs [--json]
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const KIT = process.cwd()
export const TEMPLATE_TERMS = ['Итог', 'Цель', 'Изменения', 'Доказательства', 'Решения', 'Риски', 'Дальше']

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function main() {
  const glossary = await readFile(join(KIT, 'docs', 'TERMINOLOGY.md'), 'utf8')
  const policy = await readFile(join(KIT, 'plugins', 'orchestrator', 'orchestrator.mjs'), 'utf8')
  const missingInGlossary = []
  const missingInTemplate = []
  for (const term of TEMPLATE_TERMS) {
    const inGlossary = new RegExp(`(?<![\\p{L}])${escape(term)}(?![\\p{L}])`, 'iu').test(glossary)
    if (!inGlossary) missingInGlossary.push(term)
    if (!policy.includes(term)) missingInTemplate.push(term)
  }
  const ok = missingInGlossary.length === 0 && missingInTemplate.length === 0
  const result = { ok, terms: TEMPLATE_TERMS.length, missingInGlossary, missingInTemplate }
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else {
    if (missingInGlossary.length > 0) console.error(`glossary check: undefined template terms: ${missingInGlossary.join(', ')} — define them in docs/TERMINOLOGY.md before using them`)
    if (missingInTemplate.length > 0) console.error(`glossary check: template terms missing from the root policy: ${missingInTemplate.join(', ')} — the template or the list is stale`)
    if (ok) console.log(`glossary ok (${TEMPLATE_TERMS.length} template terms defined and present in the root policy)`)
  }
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(`glossary check: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
