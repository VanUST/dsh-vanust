---
id: TASK-063
kind: task
title: "Rules panel: byte-exact save (trailing newline)"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.726Z
updatedAt: 2026-11-17T15:52:39.726Z
boardId: task-mwasplky-fr6s0x
ownerRole: BACKEND
---

Fix the Rules panel round-trip: the panel reports 103 bytes for a 104-byte file and drops the trailing newline in the textarea, so saving untouched content rewrites 103 bytes. Make load/save byte-exact (including the trailing newline) and prove it with a sha256 comparison in a real browser.

Migrated from .dsh/taskboard.json (task task-mwasplky-fr6s0x, revision 7).
