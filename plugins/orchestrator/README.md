# @cc/dsh-orchestrator

The root conversation agent becomes an orchestrator without a new preset.

On `agent/created`, the plugin registers:

- a root-only prompt section (`deployment:orchestrator-policy`) that classifies a
  request as one-shot or initiative, requires a goal and a task graph for an
  initiative, and states the delegation, model and proof rules;
- a child-only section (`deployment:specialist-policy`) that tells a delegated
  child to do exactly its brief and return evidence;
- a root-only `delegate_task` tool that creates a taskboard task, renders the
  brief (objective, scope, non-scope, inputs, acceptance, required output, proof,
  timebox), starts a `spawn` child with flash `agentOptions`, and links the child
  id to the task.

The task is created before the child, so a failure leaves a visible blocked task
rather than an invisible child. The tool is scoped to the agent, so a child cannot
recurse through it; the existing delegation depth and concurrency cap still apply.

## Config

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | subagent provider |
| `childProvider` | `deepseek-official` | child route |
| `childModel` | `deepseek-flash` | child model |
| `maxBriefChars` | `20000` | longest brief; longer briefs are truncated with a visible note |
| `promptSections` | `true` | set false to ship only the tool |
