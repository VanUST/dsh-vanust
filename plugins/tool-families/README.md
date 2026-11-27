# @cc/dsh-tool-families — each preset gets only the families its job needs

One host row that removes tool FAMILIES from an agent's view before its first request is
derived. It is the lever for the largest single item in this deployment's per-step context:
measured 2026-11-17, the 109 tools offered to a root agent carried 99,227 bytes of JSON schema,
and all 8 `hindsight_*` tools (6,430 B) sat in every child header although the child journals
record 9 Hindsight calls in total.

## Why a host row and not a preset row

MCP tools are registered at the HOST by the bridge (`@deepseek-ai/dsh-mcp-client` rows in the
home patch layer) before a preset is chosen, and a preset cannot unregister a host tool. The
tools registry does have the seam — `tools.restrict({ allow, deny })` is agent-scoped and
re-derives the visible schema set — so one host row serves every preset and the policy stays
config. A preset row would have to re-register its own MCP client per agent, i.e. one bridge
process per chat.

## Allow list, not a deny list

Since 0.1.11 a row declares what the role KEEPS. This is the inversion the 2026-11-17 design
asked for (D2 in `docs/analysis/project-state-ecosystem.json`): a deny list can only name tools
that exist when it is written, so every new host plugin (MCP bridge, Hindsight, outline,
babysitter) silently joined every role. The measured consequence: root 109 tools / 99,227 B,
backend 56 / 42,454 B, and 9 real Hindsight calls across all child journals for 6,430 B in each
of them.

```yaml
- id: tool-families
  name: '@cc/dsh-tool-families'
  config:
    projectMarkers:
      'mcp__godot__*': project.godot      # kept only where this file exists in the session cwd
    families:
      orchestrator: { allow: ['task_get', 'task_note', 'delegate_task', 'read', 'write', 'hindsight_read_page', …] }
      backend:      { allow: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'task_get', 'task_note', 'case_run', …] }
      ux:           { allow: ['mcp__playwright__*', 'read', 'write', 'bash', …] }
```

- `families.<preset>.allow` — exact tool names or `prefix*` family patterns. A name that matches
  no allow pattern is REMOVED, whether it existed when the row was written or not. The deny set
  that reaches `tools.restrict` is the complement of the allow list over the names the agent can
  see.
- `families.<preset>.deny` and `families.<preset>.projectDeny` still work and still subtract from
  the allow list: an explicitly denied name is removed even if an allow pattern matches it.
- A preset that is absent (standard, cordis, ptc and any unknown preset) keeps its full surface:
  a new role must not lose tools because nobody wrote a row for it yet (D8).
- `projectMarkers` — a family that is a PROJECT bridge, not a role capability. Kept only where
  `project.godot` exists in the session cwd; no eight-preset row allows `mcp__godot__*` (about 30
  tools / 60 KB), but the mechanism stays for a row that needs it.
- `disabled: true` — load the row and restrict nothing (one-line rollback).

**Budgets** (kept tools per header, measured after the change): orchestrator ≤40, backend ≤16,
reviewer ≤14, critic ≤14, gatherer ≤10, research ≤14, docs ≤14, ux ≤40. Hindsight is root-only
and read-only (D4): `hindsight_list_pages`, `hindsight_read_page`, `hindsight_search_pages`,
`hindsight_reflect`; workers get none of the 8.

## Behaviour

The preset is read from the `agentPresets` projection (`presetForSession(agent.session)`), which
is the authority for a selection made AFTER the session exists; the session header's
`agentPreset` is only the value the session was created with and is the fallback. On
`agent/created` and on EVERY `agent/pre-step` the row expands the preset's allow list against the
tool names the agent can actually see and calls `tools.restrict({ deny })` with the complement
when the preset in force differs from the one installed. It logs the preset, the number of denied
tools, the schema bytes that leave the prefix, which project-gated families were kept, any
pattern that matched nothing, and `[recomputed from "<previous preset>"]` on a change.

A preset change REPLACES the restriction: the disposer returned by the previous `restrict` is
lifted first, because `dsh-tools` intersects restrictions and stacking two calls would keep the
first preset's denies. A restriction is recorded as applied only when a deny list was really
installed; an empty complement (a preset whose whole visible surface is allowed) and an unmatched
deny pattern are retried on the next step (the MCP bridge may register later). It never throws
into the turn: a bridge that is down or a renamed tool is logged and skipped.

**Late host tools.** `tools.restrict` filters by exact name, so a tool registered AFTER the
restriction was installed (a plugin hot-added into a running process) is not covered by the
complement computed earlier. Measured 2026-11-17 (`reports/probes/04-prompt-mutation.md`): the
tool set is stable inside a process — one `request/header` — and a composition change arrives
with the next process, where `agent/created` recomputes. A same-process registration would need
a `tools/change` hook; that is a separate task, not part of the allow-list change.

**Why the header was not enough** (measured on a second server 2026-11-17): a session created
under `orchestrator` and then switched to `backend` kept the orchestrator restriction and was
offered all 24 `mcp__playwright__*` tools that the backend row denies — the header still said
`orchestrator`, and the one-shot `settled` flag never recomputed.

## Policy facts for a prompt owner

The row publishes a `toolFamilies` service (`ctx.provide`, optional for the consumer) so a
prompt that describes a role's tool set does not hard-code the claim:

- `presetFor(session)` — the preset in force, resolved exactly as the restriction is (the
  registry projection, then a selection remembered from a blank session, then the header);
- `factsFor(agent)` — `{ preset, removed, kept }` once a restriction is installed, `null`
  before that. `removed` names what really took tools out of that agent's view: the matched
  `deny`/`projectDeny` patterns, plus — for an allow list — a family quoted as `prefix*` when the
  whole family is excluded, and exact names when the list keeps the family only in part
  (`task_get` stays, so `task_*` would be false). A pattern that matched nothing (a Windows-only
  `pwsh` on Linux, a bridge that is down) is never quoted; `kept` names the project-gated
  families kept for the cwd.

The orchestrator's root policy reads `removed` and checks it against the set the agent can see
when the prompt is assembled, then freezes the sentence for the session (`INV-GENERATED`,
`INV-PROMPT-FROZEN` in `docs/analysis/kit-integrity-p0.json`). A composition without this row
gets `undefined` from `ctx.get('toolFamilies')` and must assert nothing instead of guessing.


## Lazy SDK declarations on a PTC preset

A PTC preset (backend, ux, presenter, gatherer, reviewer, critic, docs) used to carry the
generated `## Writing code for run_code` section: the TypeScript declaration of every visible
tool, `mcp__godot__*` and `mcp__playwright__*` included. Measured 2026-11-27 on one backend
session: 156,600 B of a 165,532 B system prompt, re-sent every step, while the task used a
handful of tools.

The section is owned by `PtcExecutor.renderSdk()` in `@deepseek-ai/dsh-tool-executor-ptc`
(installed, not vendored). This row does not edit it: it registers an agent-scoped section with
the same name (`tools:sdk`), which shadows the preset's section because the preset's plugins are
a parent scope of the agent scope. The shadow is a short header: what `run_code` is, which
modules and which MCP servers the agent can see with their tool counts, and the three forms of
the `sdk_api` call — one module, one MCP server or a few names. It is rendered from the agent's
own visible set at every assembly, so a restricted family — or `mcp__godot__*` in a project
without `project.godot` — never appears.

`sdk_api` is registered in the agent's own layer, only while the PTC executor owns that agent.
It has no "return everything" mode: `module` selects one module, `server` selects one MCP
server (`mcp__<server>__*`), `names` selects exact visible tools. The reply is capped at
64,000 B; a selection that would exceed the cap is refused with its size and the modules and
servers to choose from, so no step pulls hundreds of kilobytes of declarations. Rendering goes
through the PTC package's own `renderToolsSdk`/`renderToolsSdkPy`, so the answer is the
declaration the prompt used to carry, not a retelling. A native-executor preset gets neither
the section nor the tool.

## Verification

`node scripts/tool-families-proof.mjs` runs the decision table over a synthetic tool list for
every preset (`standard`, the eight presets, an unknown preset) in both workspace kinds and
prints the kept count, the budget, the deny count and the bytes that would leave the header. It
also covers `deny`/`projectDeny` on top of an allow list, the service facts, and the lifecycle
(preset selected after creation, blank-session selection). Against the previous bytes (0.1.10,
`--plugin /tmp/tf-old/tool-families.mjs`) it is RED: the old code ignores `allow`, every preset
keeps all tools, 15/92 checks pass. A second server proves the same effect in a real
`request/header` for all eight presets — see `rules/DEPLOYMENT.md`.
