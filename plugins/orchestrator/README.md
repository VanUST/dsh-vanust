# @cc/dsh-orchestrator

The root conversation agent becomes an orchestrator, and every delegated child runs on
the role's **agent preset** — its persona and its tool list.

On `agent/created`, the plugin registers:

- a root-only prompt section (`deployment:orchestrator-policy`) that classifies a
  request as one-shot or initiative, requires a goal and a task graph for an
  initiative, and states the delegation, model and proof rules;
- a child-only section (`deployment:specialist-policy`) that tells a delegated
  child to do exactly its brief and return evidence;
- a root-only `delegate_task` tool that requires an explicit persistent `role`
  (`UX/UI`, `BACKEND`, `RESEARCH`, `REVIEWER`, `DOCS`), creates a taskboard task, renders
  the brief, and starts the child **with the role's preset** (`agentPreset` in the start
  request). The taskboard records the role and the preset; the child id is linked to the
  task. One specialist can carry many tasks.

The preset decides what the child can actually do, so the role is not a prompt request: the
orchestrator has no `bash`, `write` or `edit` tool, the research and reviewer roles have no
shell-write tools, and a child cannot see the tools of another role. A provider without
`capabilities.agentPreset` is refused before a child exists, because the child would
silently inherit the orchestrator composition.

The root policy also carries the stop contract: a task cancel/pause/close interrupts every
linked child before the task changes state, `task_stop` force-stops a child without changing
the status, and the owner has the same authority from the Tasks panel. A refused interrupt
leaves the task where it was.

The task is created before routing, so a failure leaves a visible blocked task
rather than an invisible child. A reused child gets only the new task brief; a new
child first gets a persistent role brief. **A role's existing session is reused only when
its recorded preset matches the requested one** — a session keeps the composition it was
created with, and an older row (created before the role presets, or under a different
`preset` argument) is re-created with a note instead of being handed a brief its tools
cannot perform. The role registry is durable per workspace, so the same role is used across
tasks and root conversations (a child whose original root parent is gone is replaced under
the same role). The tool is scoped to the agent, so a child cannot recurse through it; the
existing delegation depth and concurrency cap still apply.

## Config

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | subagent provider |
| `childProvider` | `deepseek-official` | child route |
| `childModel` | `deepseek-flash` | child model |
| `maxBriefChars` | `20000` | longest brief; longer briefs are truncated with a visible note |
| `promptSections` | `true` | set false to ship only the tool |

Every `delegate_task` call names a `role`; the optional `roleDescription` becomes the new
child's responsibility line, and the optional `preset` is required when the role is a genuine
specialty outside the six. Roles are case-insensitive; one child session per role is the rule,
not one child per task.

**A role label keeps one preset.** Three refusals, all before a task row exists:
`preset_conflict` - the name is already recorded with another preset (pass `forceRole: true`
only to deliberately re-compose it); a **legacy** row with no preset - the name is history, not
a reuse target, and the refusal names the seven; and an unmapped new role - an explicit valid
`preset` is required. `AUDIT` maps to nothing on purpose: it was the one label that meant both
`reviewer` and `critic`, so the answer tells the caller to choose REVIEWER (judge a change) or
CRITIC (attack a running behaviour) instead of guessing.

The root policy catalog prints one line per `(name, preset)` pair, flags a name whose pairs
disagree as ambiguous, and lists preset-less rows in their own *Legacy roles (history only - do
not reuse)* section, so the model sees what it may reuse and what it may not.
