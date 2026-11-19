---
id: TASK-005
kind: task
title: "Ship @cc/dsh-rtk: command-aware output seam over the rtk binary"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.007Z
updatedAt: 2026-11-17T15:52:39.007Z
acceptance:
  - text: "plugins/rtk/rtk.mjs exports `name`, `inject`, `apply`, plus pure `classifyCommand(command)` and `filterOutput(command, text, opts)` so the behaviour can be exercised without a running harness."
    done: false
  - text: "classifyCommand is conservative and returns null (pass through) when the command is not a single simple command: it must refuse commands containing a pipe, &&, ;, >, or a redirect, and must refuse anything already starting with `rtk`. It maps at least: git status, git diff, git log, pytest, cargo test, go test, tsc, vitest, grep, rg, find, mypy, ruff check, ruff format, prettier, phpunit, sqlfluff lint."
    done: false
  - text: "The post-execute listener only touches configured shell tool names (default bash and pwsh), only replaces content when the text is at least minChars (default 1500), only when a filter matched, and returns next() unchanged on any spawn failure, non-zero exit, empty output, abort, or non-text content. Non-text blocks keep their position."
    done: false
  - text: "The replacement content carries a short banner naming the filter and the `rtk recall` hint, so the model knows the text was filtered and how to get the original, and elided output is never silently lost."
    done: false
  - text: "scripts/rtk-selftest.mjs runs at least five REAL commands from this repo through the transform and prints filter, before-bytes, after-bytes and exit code, exiting 0 only when every mapped case either shrank or deliberately passed through; it must run with `node scripts/rtk-selftest.mjs` and print a final verdict line."
    done: false
  - text: "No file outside plugins/rtk/ and scripts/rtk-selftest.mjs is created or modified (verify with `git status --short`)."
    done: false
  - text: "Proof to report verbatim: the selftest command, its full output, its exit code, and `git status --short` showing only your two new paths."
    done: false
boardId: task-mvp4hhu7-pgt0hj
nonScope: ["plugins/inventory.json — the orchestrator adds the row", "profile/cordis.patch.yml — the orchestrator mounts the plugin", "README.md, USERGUIDE.md, NOTICE, rules/, Makefile — orchestrator owns docs and the gate", "Any other plugin directory — do not modify them", "Writing test files — this deployment bans autotests; prove by running the product", "Committing to git"]
owner:
  kind: agent
  label: RTK-OUTPUT
  sessionId: 1df2fd48-4448-4191-b0c6-a2cfa6a469b8
ownerRole: RTK-OUTPUT
role: RTK-OUTPUT
scope: ["plugins/rtk/ (new directory: package.json, rtk.mjs, README.md)", "scripts/rtk-selftest.mjs (new proof script)", "Reading plugins/proof-guard, plugins/godot-mcp and the harness type definitions for the exact seam APIs"]
sessions:
  - sessionId: 1df2fd48-4448-4191-b0c6-a2cfa6a469b8
    label: RTK-OUTPUT
    role: RTK-OUTPUT
    status: sleeping
---

Ship a new host-only Cordis plugin `plugins/rtk/` (package `@cc/dsh-rtk`) for the dsh-kit at /home/iustimov/dsh-kit. It must do two things: (1) register one system-prompt section that tells the agent the `rtk` binary is installed, where it is, and which shell commands to prefix with `rtk` when it wants full control; (2) listen on the harness's `tools/post-execute` waterfall and, for shell tool calls only, pipe an oversized result through `rtk pipe -f <filter>` and replace the model-facing projection with the filtered text. This is the whole point: DSH's `tools/pre-execute` explicitly cannot rewrite arguments, so the binary cannot transparently rewrite `git status` into `rtk git status` the way upstream's Claude Code hook does. The output seam is the honest place, and `rtk pipe` makes it possible. Prove real byte savings on real commands, and never corrupt a result the filter does not understand.

Migrated from .dsh/taskboard.json (task task-mvp4hhu7-pgt0hj, revision 7).
