---
id: TASK-307
kind: task
title: "Update the stale designmap guard in the taskboard test"
status: done
revision: 6
createdAt: 2026-11-24T11:42:49.382Z
updatedAt: 2026-11-24T11:48:51.465Z
boardId: task-mwuml4e7-85tuea
chore: true
choreReason: "A taskboard test still asserts the designmap client registers a main-slot panel and defines LivePanel; P2 removed that registration by design and replaced the panel with the exported PageEditor, so the guard is stale and make test is red."
nonScope: ["No designmap code change, no rebuild of its bundle, no repack", "No change to the taskboard client", "No case recording"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["red before: violations 2, exit 1 — 'the Design map panel registration in main is missing' and 'lost the LivePanel'", "green after: CASE_SUMMARY {\"metrics\":{\"violations\":0}}, 1/1, exit 0", "negative control CASE_NEGATIVE_CONTROL=expect-pre-fix: violations 6, exit 1", "mutations on a bundle copy: removing the apply export gives 1 violation, reviving the main slot gives 2", "make verify exit 0 with 20/20; node scripts/test-all.mjs --only taskboard 14/14 passed"]
resultSummary: "The taskboard's designmap guard now pins the shipped contract instead of the retired v1 wiring: it fails if the built designmap bundle registers the main slot, defines LivePanel, or loses the PageEditor and apply exports, and it keeps its negative control. Proven red-first (2 violations, exit 1), green (0 violations, exit 0), with two bundle mutations showing the new assertions can fail."
role: BACKEND
scope: ["plugins/taskboard/test/panel-navigation.test.mjs — the stale assertions and the proof block"]
---

Make the taskboard's panel-navigation guard describe the shipped reality instead of the retired v1 wiring. The test asserts that the designmap client bundle registers name: "main" / key: "designmap" and defines LivePanel; both were removed on purpose when the editor moved into Project state → Map, and the bundle now exports PageEditor and a deliberate no-op apply. Rewrite those assertions to pin the new contract — no conversation.session.header.actions and no HeaderTrigger anywhere, no main-slot registration in the bundle, PageEditor present in entry.jsx and in the built bundle, apply exported — and keep the proof marker block truthful. Prove it: quote the red before the edit and the green after, then make verify.
