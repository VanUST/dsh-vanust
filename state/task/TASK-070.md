---
id: TASK-070
kind: task
title: "Fix docs and gates: stale plugin counts, capability claims, pin drift"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.817Z
updatedAt: 2026-11-17T15:52:39.817Z
acceptance:
  - text: "The stated plugin count equals the inventory row count at the reviewed commit (17 at HEAD; the working tree's 18th is another chat's uncommitted image-window and is not counted): README, USERGUIDE, DEPLOYMENT; and check-documentation FAILS when the prose count and the inventory disagree"
    done: false
  - text: "The reviewer and critic capability rows state the truth: both have bash (so 'cannot write' becomes 'cannot use the write/edit tools; bash can still write'), and the design-map ownership row notes it is registration-level, not a shell jail"
    done: false
  - text: "provision-tools --check reports drift for a pin-only entry (browser-audit gets a versionPin or the drift note covers pin entries), and a bumped PINS changes .tools/package.json"
    done: false
  - text: "The critic preset loses the direct write/edit tools (write:false, edit:false) - bash remains for fixtures - matching its 'never fix' persona"
    done: false
  - text: "make verify green, versions bumped and packed, docs updated"
    done: false
boardId: task-mwatx3ff-f1vnqh
nonScope: ["no behaviour changes to the taskboard, design-map or rules guard", "no new gate beyond the count check"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["README.md, USERGUIDE.md, rules/DEPLOYMENT.md", "scripts/check-documentation.mjs, scripts/provision-tools.mjs", "profile/cordis.patch.yml (critic fs flags only)", "packed tarballs if a plugin changes"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Make the kit's documentation and gates tell the truth: the plugin count in three docs is stale (fifteen/twelve vs 17), the reviewer/critic capability claims contradict their presets (bash writes), check-documentation only checks that plugins are named (not the count), the browser-audit tool pin is invisible to --check, and the critic preset carries write/edit despite a never-fix persona.

Migrated from .dsh/taskboard.json (task task-mwatx3ff-f1vnqh, revision 7).
