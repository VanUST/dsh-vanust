# @cc/dsh-project-state-panel — the read-only Project state panel

One panel with four modes over one selection. It is a LENS over files the state core already
writes; it owns neither a store nor a gate.

| mode | reads | answers |
|---|---|---|
| Requirements | `state/views/index.json` `reqs[]`, `state/req/*.md` frontmatter | what the business asks for, its criteria, and which links are missing |
| Board | `index.json` `tasks[]`, `state/task/*.md` | where the work is, which requirement each task belongs to, which tests link it |
| Design map | designmap's read-only `views` command | the system map, drawn by the same React Flow renderer as the Design map panel |
| Tests & trace | `index.json` `tests[]` + `reqs[]` | each test's requirement and evidence, and the REQ × TASK/TEST/DECISION matrix with its gaps |

## The contract it reads

`state/views/index.json` is the machine contract: `schemaVersion`, `lastSeq`, `counts`,
`reqs[].tasks/tests/decisions`, `tasks[].reqId/chore`, `tests[].reqId/evidenceRefs`. The panel
never parses `digest.md`, `board.md` or `traceability.md`: those are the human projections. It
reads `state/<kind>/<ID>.md` only for the fields `index.json` does not carry — title, criteria,
body, command, authorRole, revision — through the state entity format (`plugins/project-state/lib/format.mjs`).

The map-to-requirement link is not in `index.json`. The panel takes it from the analysis record
(`docs/analysis/*.json`): REQ `analysisRef` (initiative + requirementId) → `trace[]` row →
`componentId` → the scene node whose id is that component or ends with `.<component>`. This is
the one input beyond `state/`; it is read-only. When no component matches, the node drawer says
so, and the missing link is reported as a gap rather than a zero.

## What it does not do

- No write, no command that writes. The only command executed is designmap's `views` op,
  which renders in memory (`write:false`); the header says `read-only` and a proof compares
  the state snapshot before and after a full browser sweep.
- No second geometry owner: the map is `@cc/dsh-designmap`'s `SceneCanvas`, whose node
  positions, edge points and label plates come from the rendered scene. The panel's only
  overlay is its requirement badge, positioned from those scene coordinates.
- No edit affordance: no drag, no palette, no label editor, no create/close/run button. Gaps
  are clickable to navigate to the mode where the link is missing; the fix happens in the
  owner panel or the state core.
- No stale banner for links: `index.json` v1 carries no stale flag, so the panel does not
  invent one; `verify()` in the state core is the authority.
- No History tab: v1 shows `revision`, `createdAt` and `updatedAt` from the entity frontmatter.
  A journal-backed history is a later decision.

## Cross-selection

Selecting a requirement filters Board, Tests and the map highlight. From a task the drawer
shows its requirement and tests; from a test it shows its requirement and evidence references;
from a map node it shows the requirements traced to that component, and following one switches
to Requirements with the filter set. The drawer is one component for every entity, with
Overview and Links; Escape closes it and focus returns to the opener.

## Registration

The package declares `dsh.client` with `external: ["@cc/dsh-designmap"]`, so the loader
materializes designmap's exports before this bundle and the map renderer is the installed one.
The host half is an empty row: the panel has no tool, no service and no prompt section.
