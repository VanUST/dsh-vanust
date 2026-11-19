---
id: TASK-063
kind: task
title: "Rules panel: byte-exact save (trailing newline)"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.726Z
updatedAt: 2026-11-17T15:52:39.726Z
acceptance:
  - text: "The Rules panel round-trips a file byte-exactly, including a trailing newline: load a 104-byte file, save unchanged, sha256 identical; the byte counter shows the true file size"
    done: false
  - text: "A textarea that starts with a trailing newline does not lose it on save; the panel never trims, normalizes or re-encodes the text"
    done: false
  - text: "Proven on a second server with a real browser: load -> save untouched -> sha256 comparison; then edit -> save -> exact bytes"
    done: false
  - text: "make verify green, project-rules version bumped and packed"
    done: false
boardId: task-mwasplky-fr6s0x
nonScope: ["no change to the human-only guard or the design-map gate", "no new panel features beyond the byte-exact round trip"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: [plugins/project-rules/client.js, "plugins/project-rules/package.json + packed tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Fix the Rules panel round-trip: the panel reports 103 bytes for a 104-byte file and drops the trailing newline in the textarea, so saving untouched content rewrites 103 bytes. Make load/save byte-exact (including the trailing newline) and prove it with a sha256 comparison in a real browser.

Migrated from .dsh/taskboard.json (task task-mwasplky-fr6s0x, revision 7).
