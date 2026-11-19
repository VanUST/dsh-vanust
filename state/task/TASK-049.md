---
id: TASK-049
kind: task
title: "Install the role toolchain and prove it per role"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.549Z
updatedAt: 2026-11-17T15:52:39.549Z
acceptance:
  - text: "Every tool in the set is pinned to a concrete current version, with the release date, licence and maintenance signal recorded in the report and in provision-tools.mjs"
    done: false
  - text: "Installed into the kit's own tools location (never sudo, never a global pip into conda base), checksummed where a release artifact is downloaded, idempotent on re-run"
    done: false
  - text: "Each tool runs a real minimal command on this machine and the exact command + output + exit code is quoted"
    done: false
  - text: "The role personas name the tools each role can actually run, and the bash-less roles (orchestrator, research) are called out with what they cannot run"
    done: false
  - text: "provision-tools.mjs installs the full set on a fresh machine and reports missing ones without failing the boot"
    done: false
  - text: "make verify keeps passing and the docs table lists the new tools"
    done: false
boardId: task-mwaox0w5-12fswo
nonScope: ["no MCP server rows for these tools yet - T4 decides whether MCP can be gated per role; instal the CLIs instead", "no changes to the taskboard, design-map, or other plugins except a small tool wrapper if a bash-less role needs one (ask first)", "no commits; the orchestrator integrates", "no test suites: prove by running the tools"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 107c5201-38c5-4577-8555-f359da86ffc7
ownerRole: BACKEND
role: BACKEND
scope: ["scripts/provision-tools.mjs (install/verify, idempotent, pinned, checksummed)", "the kit's external-tools install location and PATH wiring", "profile/cordis.patch.yml role personas (a 'your tools' line per role only)", "rules/DEPLOYMENT.md tool table and USERGUIDE first-run checks", "one report at .dsh/research/role-toolchain-install.md"]
sessions:
  - sessionId: 107c5201-38c5-4577-8555-f359da86ffc7
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Install and verify the role toolchain found by the 2026-11-10 research, on this machine and through the kit's provisioning. For each tool: confirm it is current and maintained today (latest release, date, licence, last commit), pin that version, install it without sudo into the kit's tools location, run a real minimal command, and record the evidence. Then make the six role personas name only the tools the role can actually invoke, and expose the bash-less roles' gap honestly (orchestrator and research have no shell).

Migrated from .dsh/taskboard.json (task task-mwaox0w5-12fswo, revision 7).
