# @cc/dsh-orchestrator

The root conversation agent becomes an orchestrator without a new preset.

On `agent/created`, the plugin registers:

- a root-only prompt section (`deployment:orchestrator-policy`) that classifies a
  request as one-shot or initiative, requires a goal and a task graph for an
  initiative, and states the delegation, model and proof rules;
- a child-only section (`deployment:specialist-policy`) that tells a delegated
  child to do exactly its brief and return evidence;
- a root-only `delegate_task` tool that requires an explicit persistent `role`
  (`UX/UI`, `BACKEND`, `BUSINESS`, `RESEARCH`), creates a taskboard task, renders
  the brief, and routes it to that role's existing child with `sendMessage`;
  it starts a `spawn` child with flash `agentOptions` only when the role has no
  child yet, registers the role in the taskboard's `agents[]`, and links the child
  id to the task. One specialist can therefore carry many tasks.

The task is created before routing, so a failure leaves a visible blocked task
rather than an invisible child. A reused child gets only the new task brief; a new
child first gets a persistent role brief. The role registry is durable per
workspace, so the same role is used across tasks and root conversations (a child
whose original root parent is gone is replaced under the same role). The tool is
scoped to the agent, so a child cannot recurse through it; the existing delegation
depth and concurrency cap still apply.

## Config

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | subagent provider |
| `childProvider` | `deepseek-official` | child route |
| `childModel` | `deepseek-flash` | child model |
| `maxBriefChars` | `20000` | longest brief; longer briefs are truncated with a visible note |
| `promptSections` | `true` | set false to ship only the tool |

Every `delegate_task` call must name a `role`; the optional `roleDescription`
becomes the new child's responsibility line. Roles are case-insensitive; one
child session per role is the rule, not one child per task.
