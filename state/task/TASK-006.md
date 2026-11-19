---
id: TASK-006
kind: task
title: "Ship @cc/dsh-babysitter: drive the real babysitter CLI from DSH tools"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.018Z
updatedAt: 2026-11-17T15:52:39.018Z
acceptance:
  - text: "The real CLI is installed and its actual capabilities are reported from its own `--help` output, not from the README."
    done: false
  - text: "plugins/babysitter/babysitter.mjs exports `name`, `inject`, `apply` and registers four tools: run (process file or prompt, workspace, mode), status (one run id or the recent list, read from the journal), resume (run id), and doctor."
    done: false
  - text: "Every spawn is bounded by a timeout (default 600000 ms, configurable), captures stdout and stderr separately with a tail cap so a huge log cannot flood the context, returns the run id when the CLI prints one, and surfaces the exit code verbatim. A timeout returns a failure that names the timeout, not a hang."
    done: false
  - text: "With the CLI absent (simulate by PATH cleared to a minimal value and no absolute binary configured) every tool returns a single actionable message naming what to install, never a stack trace."
    done: false
  - text: "scripts/babysitter-selftest.mjs proves, in order: CLI resolved; `--help` exit code; one real headless process executed end to end with the internal harness (write the trivial process file it needs under a temp dir, not into the repo); the journal entries it produced, listed. It prints each step and exits 0 only if the end-to-end run really produced journal evidence."
    done: false
  - text: "The README states plainly: what works, what needs an external harness CLI for LLM-backed tasks, that DSH itself is not a babysitter harness, and that the taskboard remains the outer ledger. No claim that is not proven by the selftest."
    done: false
  - text: "No file outside plugins/babysitter/, scripts/babysitter-selftest.mjs and the temp dir is created or modified in the repo (verify with `git status --short`)."
    done: false
  - text: "Proof to report verbatim: install output, CLI versions, the full selftest output with its exit code, and `git status --short` showing only your two new paths."
    done: false
boardId: task-mvp4hhz7-ilm15b
nonScope: ["plugins/inventory.json, profile/cordis.patch.yml, README.md, USERGUIDE.md, NOTICE, rules/, Makefile — the orchestrator integrates these", "Any other plugin directory", "Writing test files — this deployment bans autotests; prove by running the product", "Authoring a babysitter process library or blueprints — out of scope", "Running babysitter's MCP server as the integration path, and committing to git"]
owner:
  kind: agent
  label: BABYSITTER-ADAPTER
  sessionId: 9f32259d-1f65-4c71-82d7-8ad76e8417a8
ownerRole: BABYSITTER-ADAPTER
role: BABYSITTER-ADAPTER
scope: ["plugins/babysitter/ (new directory: package.json, babysitter.mjs, README.md)", "scripts/babysitter-selftest.mjs (new proof script)", "Installing the npm package globally and inspecting its real CLI surface", "Reading plugins/proof-guard and plugins/papers for tool-registration shape and style"]
sessions:
  - sessionId: 9f32259d-1f65-4c71-82d7-8ad76e8417a8
    label: BABYSITTER-ADAPTER
    role: BABYSITTER-ADAPTER
    status: sleeping
---

Babysitter (https://github.com/a5c-ai/babysitter) has no adapter for DSH among its 12 harnesses, so bridge it as a thin, verifiable tool plugin at /home/iustimov/dsh-kit/plugins/babysitter/ (package `@cc/dsh-babysitter`). First install and probe the real CLI, then expose tools that shell out to it: run a process, report status from the journal, resume a run, and run diagnostics. The adapter must never hang the agent, must refuse with a precise message when the CLI is absent, and must tell the truth about what a babysitter process can and cannot do when the host harness is DSH rather than one of its supported editors. Report the mapping honestly even if part of it does not work — a documented gap is a good result; a fabricated success is not.

Migrated from .dsh/taskboard.json (task task-mvp4hhz7-ilm15b, revision 6).
