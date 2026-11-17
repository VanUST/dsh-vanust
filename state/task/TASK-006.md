---
id: TASK-006
kind: task
title: "Ship @cc/dsh-babysitter: drive the real babysitter CLI from DSH tools"
status: done
revision: 1
createdAt: 2026-11-17T15:52:39.018Z
updatedAt: 2026-11-17T15:52:39.018Z
boardId: task-mvp4hhz7-ilm15b
ownerRole: BABYSITTER-ADAPTER
---

Babysitter (https://github.com/a5c-ai/babysitter) has no adapter for DSH among its 12 harnesses, so bridge it as a thin, verifiable tool plugin at /home/iustimov/dsh-kit/plugins/babysitter/ (package `@cc/dsh-babysitter`). First install and probe the real CLI, then expose tools that shell out to it: run a process, report status from the journal, resume a run, and run diagnostics. The adapter must never hang the agent, must refuse with a precise message when the CLI is absent, and must tell the truth about what a babysitter process can and cannot do when the host harness is DSH rather than one of its supported editors. Report the mapping honestly even if part of it does not work — a documented gap is a good result; a fabricated success is not.

Migrated from .dsh/taskboard.json (task task-mvp4hhz7-ilm15b, revision 6).
