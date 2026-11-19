---
id: TASK-150
kind: task
title: "Delete stray root-level PNG evidence files"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.038Z
updatedAt: 2026-11-17T15:52:41.038Z
acceptance:
  - text: "find -maxdepth 1 -name '*.png' returns nothing"
    done: false
  - text: "nested PNG count unchanged (169)"
    done: false
  - text: "git status stays clean"
    done: false
boardId: task-mwjamrew-45jv4n
inline: true
nonScope: ["PNG files in subdirectories: docs/designmap/screenshots/, .dsh/, plugins/** fixtures", "tracked files (none of the root PNGs is tracked)"]
resultEvidence: ["find /home/iustimov/dsh-kit -maxdepth 1 -name '*.png' | wc -l -> 0", "find /home/iustimov/dsh-kit -mindepth 2 -name '*.png' | wc -l -> 169 (unchanged)", "git status --short -> empty (root PNGs were gitignored via /*.png)"]
resultSummary: "Deleted the 63 accidental root-level PNG screenshots; every nested PNG (169 files under docs/, .dsh/, plugins/) is untouched and the working tree is clean."
scope: ["/home/iustimov/dsh-kit/*.png (maxdepth 1 only)"]
---

Remove the 63 screenshot PNGs that landed at the repository root by mistake. They are gitignored local evidence, not source; nested PNGs (docs/designmap/screenshots, .dsh/, fixtures) must stay.

Migrated from .dsh/taskboard.json (task task-mwjamrew-45jv4n, revision 3).
