---
id: TASK-142
kind: task
title: "M4: package, docs, retire the old panel"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.900Z
updatedAt: 2026-11-17T15:52:40.900Z
acceptance:
  - text: "pack-plugin.mjs packs the new package with a bumped version and reports the sha256"
    done: false
  - text: "README documents every tool, file location, and the read-only/edit split"
    done: false
  - text: "profile/cordis.patch.yml wiring is proposed as a diff and checked against dsh-doc's bundle rules"
    done: false
  - text: "The report lists per-milestone evidence and the unverified install step explicitly"
    done: false
  - text: "The vision loop is present but off by default, or explicitly dropped with a reason"
    done: false
boardId: task-mwj4equ1-jk1d31
nonScope: ["installing or restarting the live :3080 profile (human decision)", "deleting plugins/design-map 0.2.0 without the orchestrator's explicit decision", "new features beyond M0-M3"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 34e215fd-175e-46e0-9911-3e458feff431
ownerRole: BACKEND
preset: backend
resultEvidence: ["pack-plugin: 0.1.0 -> 0.1.1, plugins/cc-dsh-designmap-0.1.1.tgz sha256 585fde54…; orchestrator re-listed it: 24 files, package/{client.js,index.js,package.json,README.md,src/*} with no harness/node_modules/fixtures", "npm test 94/94 exit 0 (orchestrator re-ran); acceptance harness ok:true; living-doc driver ok:true", "packed-bytes smoke: extracted tarball host run exported SVG 1476 B, nodes 2 edges 1; PNG optional with an external converter and a named refusal when absent", "check-documentation ok; check-portability 15/17 with two pre-existing failures in harness/spike dirs (out of scope)", "README documents seven tools, /designmap ops, file layers, read-only vs edit, determinism, licences (elkjs EPL-2.0 OR GPL-3.0-or-later), PNG opt-in and the vision-loop drop", "M4-EVIDENCE.md indexes M0-M4 evidence and lists unverified items (live install, :3080 panel registration, real screen reader, Firefox/WebKit, touch)", "retirement written as a ready-override proposal; the applied half was deferred by the orchestrator so the old proven panel stays mounted until the new one is accepted"]
resultSummary: "Packaged and documented the redesign: @cc/dsh-designmap 0.1.1 tarball (24 files) with a packed-bytes host smoke, README (tools, command, layers, determinism, licences, PNG opt-in, vision loop dropped), kit inventory/profile/README/USERGUIDE/DEPLOYMENT updates, M4 evidence index and a retirement plan. Live install and :3080 restart deliberately left to the human; the retirement was deferred to protect the working panel until the new one is accepted."
role: BACKEND
scope: ["plugins/designmap/package.json, README.md, files list", "plugins/*.tgz for the new package and profile/cordis.patch.yml row", "docs/designmap/ final report"]
sessions:
  - sessionId: 34e215fd-175e-46e0-9911-3e458feff431
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Close the redesign: package @cc/dsh-designmap (host + client), its README and profile wiring, an M4 evidence report, and the intentional retirement plan for the 0.2.0 Excalidraw panel. Include the optional PNG export and the vision-loop switch left OFF by default, and state plainly what was not verified (live install/restart is the human's call).

Migrated from .dsh/taskboard.json (task task-mwj4equ1-jk1d31, revision 7).
