---
id: TASK-306
kind: task
title: "Case ids for Russian titles: transliterate, never collapse to one constant"
status: done
revision: 6
createdAt: 2026-11-24T11:31:32.150Z
updatedAt: 2026-11-24T11:43:10.763Z
acceptance:
  - text: "slugify of a Cyrillic title returns a non-empty ASCII kebab id, quoted for three real Russian titles"
    done: false
  - text: "two different Cyrillic titles give two different ids, and a title with no transcribable letter falls back to a stable hash id, not a shared constant"
    done: false
  - text: "the ASCII path is unchanged: an existing case title from docs/cases still slugifies to its current id, so no stored case is renamed"
    done: false
  - text: "safeCaseId accepts every id slugify returns"
    done: false
  - text: "tests cover the Cyrillic, mixed, punctuation-only and empty cases; suites and make verify are green; the plugin is repacked"
    done: false
boardId: task-mwum6mh8-pakm02
chore: true
choreReason: "The owner asked for this defect to be fixed now: case_record cannot name a case whose title is Cyrillic, because the id builder strips every non-Latin letter."
nonScope: ["No change to the case schema, the gate, the runner or the recorded cases", "No renaming of existing case files", "No analysis-gate or design-map work"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["red first on the HEAD copy: Cyrillic titles all gave 'case'; the new test failed there and the recorded driver failed with actual 'case' against /^case-[0-9a-f]{12}$/", "product path through case_record with a fake context: 'Проверка запуска кейса' -> proverka-zapuska-keysa, 'Случай с русским заголовком' -> sluchay-s-russkim-zagolovkom, 'Отчёт о покрытии' -> otchet-o-pokrytii, punctuation-only -> case-6bf9b34b21b2, empty -> rejected INVALID_CASE", "79 recorded titles compared old vs new: 75 identical, 4 explained", "suite 73/73, docs/cases driver 5/5, make verify exit 0 with 20/20 and tarball:matches-source; 0.1.38 byte-identical to source"]
resultSummary: "Case ids work for Russian titles: slugify transliterates Cyrillic with a table we own, falls back to case-<12 hex> when nothing survives, and the 60-character slice no longer leaves a trailing dash that safeCaseId refuses. Proven through the product path (case_record) on five titles, red-first against the old code, with 75 of 79 recorded titles unchanged so no stored case was renamed. Suite 73/73, the case-library driver 5/5, make verify exit 0 with 20/20 and tarball == source; plugin repacked at 0.1.38."
role: BACKEND
scope: ["plugins/test-cases/lib/schema.mjs — slugify and the transliteration table", "plugins/test-cases/test/ — the slugify tests", "package.json version, dist, tarball"]
---

Fix the case-library id builder so a case whose title is written in Russian gets a real id instead of a degenerate one. Today slugify() strips every Cyrillic letter and returns the constant 'case', so two Russian titles collide and a title that becomes empty is reported as an empty identifier. Transliterate Cyrillic to ASCII with a table we own before the slug rules run, fall back to a short sha1-based id when nothing transcribable survives, and keep the ASCII behaviour byte-identical so no stored case is renamed. Prove with quoted ids for three Russian titles, two titles that must differ, and a control title from an existing case file.
