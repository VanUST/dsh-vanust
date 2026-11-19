# @cc/dsh-role-model

Give one role its own model route, and a fallback that keeps the turn alive when that route runs
out of quota.

The deployment has one default model (`@deepseek-ai/dsh-agent-default-model`), so a role that must
run on an expensive model was re-routed by hand in every session, and an exhausted subscription
took the whole turn down. This plugin holds the rule instead:

- **before a fresh session's first request** it selects the role's route (`agent/created` is the
  last point where a selection reaches the FIRST request);
- **when the provider reports the quota is gone** it selects the role's fallback and retries the
  step (`agent/request-error` + `{ kind: 'retry' }`), so the human sees an answer on the cheap
  route instead of a dead turn.

A route rewritten on `agent/request` would throw: this harness freezes the step's route and rejects
a different one. That is why the plugin uses `agent.model.select()`, which records a durable
`model/selection` event, and never the request waterfall.

## Config

```yaml
- id: role-model
  name: '@cc/dsh-role-model'
  config:
    quotaCodes: [QUOTA, ACCOUNT_QUOTA]   # default; RATE_LIMIT stays with the harness retry policy
    roles:
      architect:
        provider: openai-codex
        model: gpt-6.2-astra
        reasoningEffort: high
        fallback:
          provider: deepseek-official
          model: deepseek-flash
          reasoningEffort: max
```

| Field | Meaning |
|---|---|
| `roles.<preset>` | The preset id whose sessions get this rule. A preset without a rule keeps the deployment default. |
| `roles.<preset>.provider` / `.model` | Required pair; a half-rule is dropped with one warning. |
| `roles.<preset>.reasoningEffort` | Optional; omit to let the adapter resolve its default. |
| `roles.<preset>.fallback` | Optional second route, selected only on a quota failure. A role without it never switches. |
| `quotaCodes` | Failure codes that mean "out of quota". Default `QUOTA` and `ACCOUNT_QUOTA` — the provider-neutral codes `dsh-llm` assigns through `isQuotaExceededError()`. |

## When the rule does not apply

- A session that **already sent a request** keeps its route: a resumed chat is not re-routed by a
  server restart.
- A `model/selection` event recorded **since the plugin loaded** wins: the human's pick is not
  undone.
- Switching the preset inside a running session does not re-route it. The session was created on
  another preset, and the first request has already fixed its route — pick the model in the
  composer, or start the chat on the role's preset.
- Only **one switch per agent**: a provider that answers `QUOTA` for every route cannot loop the
  step. The second failure is terminal.

## Cost note

The fallback is meant to be the cheap deployment default. Setting a fallback that is also
expensive, or leaving a role without one, is a spending decision, not a safety net.
