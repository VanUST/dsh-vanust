# @cc/dsh-delegation-brief — briefs rendered from the register

Two root-only tools make a delegation brief a product of the project state instead of prose:

- **`delegation_brief`** — for an ACCEPTED REQ it renders the brief: the requirement and its
  acceptance criteria **verbatim** (each criterion gets a stable `REQ-…-C01` id), the related
  decisions, the tests that must pass with their commands/paths/evidence, the caller's
  non-scope, and the return format. It returns the text and `briefHash` (sha256 of the bytes).
  The same request and the same state give the same bytes.
- **`delegation_return`** — takes the `briefHash`, the same `reqId`/`role`/`nonScope` and the
  worker's `{status: done|blocked|design_problem, criteria:[{id,pass,evidence}], questions:[]}`.
  It rerenders the brief from the CURRENT state and refuses:
  - `brief_stale` — the criteria changed after the brief was rendered;
  - `return_unmapped` — the return names a criterion the brief does not have, repeats one, or
    omits one;
  - `return_invalid` — bad status, missing boolean `pass`, or a pass without evidence.

## Refusals

| code | when |
|---|---|
| `cold_start_required` | no `ccProjectState` service, or the workspace has no `state/views/index.json` |
| `feature_required` | the REQ is not in the register, or it is finished/rejected: a brief is rendered for `proposed`, `open` or `accepted`, which is what the register can actually hold (`analysis_upsert` mirrors a planned requirement to `proposed`) |
| `criteria_missing` | the REQ has no acceptance criteria |

## Gates

The tools and a short **static** prompt section (`deployment:delegation-brief`) are registered
only on a root session whose preset in force is `orchestrator` (resolved through
`toolFamilies.presetFor`, header fallback). A worker never receives them. The section carries no
data that changes between turns — the state itself is delivered by `@cc/dsh-state-feed`.

## Tests

`node --test plugins/delegation-brief/test/*.test.mjs` — verbatim criteria, byte-identical
renders, each refusal, the return mapping, stale/unmapped refusals and the worker exclusion.
