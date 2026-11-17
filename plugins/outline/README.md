# @cc/dsh-outline

A cheap table of contents for a source file, so an unknown file does not have to be read
whole before it can be understood.

The `outline` tool runs `code-skeleton-mcp outline <path> --depth N` (tree-sitter WASM
grammars for JavaScript, TypeScript, TSX, Python and Go, committed inside that package - it
never fetches grammar bytes at run time) and returns the JSON it prints:

```json
{
  "path": "plugins/orchestrator/orchestrator.mjs",
  "language": "javascript",
  "symbols": [
    {
      "kind": "function",
      "name": "presetForRole",
      "line": 139,
      "endLine": 141,
      "signature": "function presetForRole(role)",
      "docstring": "The preset a role name denotes, or undefined when it denotes none of the seven."
    }
  ]
}
```

The body is never in the result. Reading the file is still how code is read: the outline
tells you which lines to read. Measured on 2026-11-17, warm cache, installed 0.1.3:
`plugins/orchestrator/orchestrator.mjs` 83 148 B → 4 791 B (−94.2 %, ~0.4 s);
`plugins/analysis/store.mjs` 100 991 B → 8 924 B (−91.2 %); two runs on the same file are
byte-identical.

Languages: JavaScript, TypeScript, TSX and Python report functions, classes and interfaces;
Go reports types only (functions are missing from the Go grammar's outline in 0.1.3). Any
other language, and any non-code file, comes back as a named failure, not as an empty
outline.

## Why the host level

The row mounts on the host, not inside a preset, so the root and all seven presets inherit
it. An outline is not a role's speciality: any agent that cannot outline a file pays for the
whole file on the first step and again on every later step, and the same section teaches the
pairing with `read` whoever the agent is.

## Configuration

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` registers neither the section nor the tool. |
| `bin` | `code-skeleton-mcp` on PATH | executable, absolute or a name; the configured candidate is the one used, not a fallback. |
| `timeoutMs` | `10000` | kill one outline call after this long and report `ETIMEDOUT`. |
| `maxBytes` | `262144` | reject a larger stdout with `EOVERFLOW` instead of truncating it. |

## Tool arguments

| argument | type | default | meaning |
| --- | --- | --- | --- |
| `path` | string, required | - | file to outline, relative to the session workspace or absolute. |
| `depth` | integer 1-3 | `1` | nesting depth; clamped. |
| `docstrings` | boolean | `true` | first-line docstrings/JSDoc; `false` passes `--no-docstrings`. |

A failed call returns `{ok: false, code, message}`; the codes are `NO_PATH`, `NO_BIN`,
`ESPAWN`, `ETIMEDOUT`, `EOVERFLOW`, `EXIT`, `EMPTY_OUTPUT`, `NON_JSON`, `BAD_SHAPE`. A
non-code file has no symbols, and the binary's "Unsupported file type" line is what the
message quotes.

## Degradation

`resolveOutlineBin` probes the candidate once with a real outline call and returns null when
it cannot outline a JavaScript file, so no dead tool is registered. The prompt section then
says `outline unavailable` and names where the plugin looked. This binary needs a real call
rather than a version probe: it implements no `--version` (any unknown first argument starts
the stdio MCP server). On a failure it prints the reason to stderr and exits non-zero, which
the tool reports as `EXIT`; a zero exit with empty or non-JSON stdout is a named failure too
(`EMPTY_OUTPUT`, `NON_JSON`), so a broken shim's silent success cannot read as an empty file.

## Proof

```bash
node scripts/outline-selftest.mjs
```

Runs the real binary over two files of this kit, asserts at least 90 % byte saving, compares
two runs byte for byte, exercises the degradation path (a PATH with no binary), and feeds
`parseOutlineOutput` a broken JSON and a document above the output limit. Exit 0 only when
every case holds.
