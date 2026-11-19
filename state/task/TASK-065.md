---
id: TASK-065
kind: task
title: "Adversarial test of the delivery"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.751Z
updatedAt: 2026-11-17T15:52:39.751Z
acceptance:
  - text: "The taskboard invariants are attacked through the real registered tools/command on a temp workspace: role-less creation, illegal transitions, CAS races, malformed board JSON, cross-chat writes, and a bounded fuzz of transition sequences; every accepted-but-illegal or rejected-but-legal case is reported with the exact input"
    done: false
  - text: "The project-rules guard is attacked with at least five bypass shapes (relative path, cd, symlink, variable-built path, tee/sed -i/node -e) and the report states which bypasses actually work"
    done: false
  - text: "The design map is fed malformed scenes (missing elements, duplicate ids, wrong types, non-JSON, huge input, rev conflicts) and the result is either a named refusal or a preserved scene - never a corrupted file; atomic write is checked"
    done: false
  - text: "The Rules panel byte round-trip (known 104->103 bytes) is reproduced and the exact loss named"
    done: false
  - text: "Every finding is reproducible with the exact command and the smallest input, quoted with exit codes; work happens in /tmp fixtures only and the repository is never modified"
    done: false
boardId: task-mwatgtkb-kq0p51
nonScope: ["no fixes - report only", "never modify the kit repository, install anything or restart a server", "out of scope: image-window, session-store and start.sh/ps1 (another chat's uncommitted work)"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["/tmp fixtures and disposable copies only", "the committed plugin sources under plugins/ as the target under test"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Adversarially test the delivered features through their real interfaces: try to bypass the taskboard lifecycle invariants, the project-rules human-only guard, the design-map scene validation and the cache contract, and report reproducible failures with minimal inputs - or an explicit what-was-tried-and-what-could-not-be-broken report.

Migrated from .dsh/taskboard.json (task task-mwatgtkb-kq0p51, revision 8).
