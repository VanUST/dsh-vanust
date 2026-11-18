---
id: TEST-057
kind: test
title: "State panel right column toggles"
status: verified
revision: 5
createdAt: 2026-11-18T12:30:35.407Z
updatedAt: 2026-11-18T12:46:23.954Z
authorRole: BACKEND
caseId: state-panel-right-column-toggles
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm3nlmo-juua7-1:red:fail, mwm3npuo-jhx6h-1:green:pass, mwm3qmic-rz2ao-1:green:pass, mwm47sqb-qtrmw-1:green:pass]
frozenHash: 8b205a11b6af0140e3909c36cb13d55b31b8b4b177dde3f32816aa9b22f44d36
reqId: REQ-108
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The state panel hides its right column (the evidence rail, ps-rail) from its own header button and brings it back on the second press; the button reflects the state through aria-pressed and its label switches between «Скрыть правую колонку» and «Показать правую колонку».
