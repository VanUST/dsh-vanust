# @cc/dsh-tool-families — each preset gets only the families its job needs

One host row that removes tool FAMILIES from an agent's view before its first request is
derived. It is the lever for the largest single item in this deployment's per-step context:
measured on a real BACKEND child (2026-11-13), the 107 offered tools carried 114,989 bytes of
JSON schema, of which `mcp__godot__*` was 60,679 B (52.8%) and `mcp__playwright__*` 16,280 B
(14.2%). Every kit tool together was about 20%.

## Why a host row and not a preset row

MCP tools are registered at the HOST by the bridge (`@deepseek-ai/dsh-mcp-client` rows in the
home patch layer) before a preset is chosen, and a preset cannot unregister a host tool. The
tools registry does have the seam — `tools.restrict({ allow, deny })` is agent-scoped and
re-derives the visible schema set — so one host row serves every preset and the policy stays
config. A preset row would have to re-register its own MCP client per agent, i.e. one bridge
process per chat.

## Config

```yaml
- id: tool-families
  name: '@cc/dsh-tool-families'
  config:
    projectGated:
      'mcp__godot__*': project.godot      # kept only where this file exists in the session cwd
    families:
      orchestrator: { deny: ['mcp__godot__*'] }
      ux:           { deny: ['mcp__godot__*'] }
      backend:      { deny: ['mcp__playwright__*', 'mcp__godot__*'] }
      reviewer:     { deny: ['mcp__playwright__*', 'mcp__godot__*'] }
      critic:       { deny: ['mcp__playwright__*', 'mcp__godot__*'] }
      research:     { deny: ['mcp__playwright__*', 'mcp__godot__*'] }
      docs:         { deny: ['mcp__playwright__*', 'mcp__godot__*'] }
```

- `families.<preset>.deny` — exact tool names or `prefix*` family patterns. A preset that is
  absent keeps its full surface, and so does a session with no preset (`standard`): a new role
  must not lose tools because nobody wrote a row for it yet.
- `projectGated` — a family that is a PROJECT bridge, not a role capability. `mcp__godot__*`
  drives a Godot editor, so it is kept for a session whose cwd holds `project.godot` and denied
  everywhere else whatever the preset. Without this, "the backend role may use Godot" would put
  an editor bridge in every repository that role ever opens.
- `disabled: true` — load the row and restrict nothing (one-line rollback).

**Hindsight is never in a policy row.** The `hindsight_*` tools are a memory capability a child
needs to read its own bank; the automatic recall and write-back stay root-only in the plugin
itself, which is a different switch.

## Behaviour

On `agent/created` the row expands the preset's patterns against the tool names the agent can
actually see, calls `tools.restrict({ deny })` once, and logs the preset, the number of denied
tools, the schema bytes that leave the prefix, which project-gated families were kept, and any
pattern that matched nothing. It never throws into the turn: a bridge that is down or a renamed
tool is logged and skipped.

## Verification

`node scripts/tool-families-proof.mjs` runs the decision table over a synthetic tool list for
every preset (`standard`, the seven roles, an unknown preset) and prints the deny list, the kept
project-gated families and the bytes that would leave the header. A second server proves the
same effect in a real `request/header` — see `rules/DEPLOYMENT.md`.
