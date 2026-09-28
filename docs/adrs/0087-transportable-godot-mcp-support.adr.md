---
id: "0087"
title: The kit ships Godot MCP support as a spec, a launcher resolution and a refusal — not as an MCP implementation
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-25T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-25-transportable-godot-mcp-support.md
  hash: sha256:c1414c4ecc7b1d79a51ce49e01f945243e6125af7ba489c04db199400a9d14db
zones:
  - shipped-plugins
  - deployment-rules
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.mcp-support-routes-through-the-shipped-bridge
    statement: The kit's MCP support declares servers and materializes the harness's own @deepseek-ai/dsh-mcp-client row; it implements no MCP protocol, and the server list is a canonical projected file rather than machine-local configuration, so a converged machine has the server without configuring it.
    checks:
      # The claim is a packaging and provenance claim, and these two checks are what can
      # decide it mechanically: nothing absolute-Windows-shaped and no machine path is
      # shipped, and the inventory row, source tree, tarball and mounted profile row all
      # agree. Neither check can decide that no MCP code exists, which is why the
      # statement says what it says rather than claiming an enforcement it does not have.
      - type: command
        run: node scripts/check-portability.mjs
        expects: no absolute Windows path is shipped in the new plugin's source
        outputContains: '[PASS] no-absolute-windows-paths'
        timeoutMs: 120000
      - type: command
        run: node scripts/check-portability.mjs
        expects: the plugin's inventory row, source tree, tarball and mounted profile row agree
        outputContains: '[PASS] inventory:matches-disk'
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.the-mcp-sync-refuses-a-foreign-patch-layer
    statement: The MCP sync writes the harness home patch layer only when every element in it already carries the deployment's own row id, and otherwise writes nothing and names the path, because the same file is written by the Godot addon's own client configurator and a merge that guessed at another writer's entries would destroy them.
    checks:
      - type: command
        run: node scripts/check-portability.mjs
        expects: every module the plugin ships is listed in its manifest, so an installed copy has the code the refusal lives in
        outputContains: '[PASS] files-complete:plugins/godot-mcp'
        timeoutMs: 120000
      - type: command
        run: node scripts/check-portability.mjs
        expects: the installed tarball still carries the bytes this source built
        outputContains: '[PASS] tarball:matches-source'
        timeoutMs: 120000
  - op: upsert
    id: deployment-rules.the-mcp-server-list-carries-no-machine-path
    statement: The projected MCP server spec names a launcher and candidate locations rather than an absolute machine path, so one spec serves every machine and the launcher is resolved where it runs; provisioning the engine and the launcher is tooling code rather than a manual step.
    checks:
      - type: command
        run: node scripts/check-portability.mjs
        expects: a repacked tarball of this plugin carries a new version, so pnpm cannot serve the previous bytes from its lockfile
        outputContains: '[PASS] tarball:version-bumped'
        timeoutMs: 120000
---

## Context

The deployment had no MCP support, and the ask was for a Godot MCP server connected to the
harness and **transferable through the workspaces of other machines**. Two measured facts
shaped the design.

First, the harness **already ships** `@deepseek-ai/dsh-mcp-client` — a complete MCP client
bridge on `@modelcontextprotocol/sdk` — which resolves from the profile even though no row
mounts it. Second, the chosen server (`hi-godot/godot-ai` 4.2.3) has a **first-class
DeepSeek Harness strategy**, and its own documentation states the registration mechanism
exactly: an `insert` row naming that bridge in `$DSH_HOME/cordis.patch.yml`, launch nested
under `config`, `serverName` naming the model-facing toolspace.

So the only open question was **where the configuration lives**. A UI-driven "Configure"
writes it to one machine, which makes it that machine's configuration and leaves every other
machine at zero — the outcome the ask rules out.

The risk this record mainly addresses is not the happy path, which was proven before it was
wired: driving the exact configured argv over stdio answered `initialize` and enumerated 47
tools. It is that this change makes the deployment's MCP configuration a file the kit
**rewrites**, and that file is also written by a human-facing tool. A silent loss of someone's
configured entries would be worse than a refusal.

## Decision

1. **`@cc/dsh-godot-mcp` ships in the kit and implements no MCP.** It owns the canonical
   server spec, resolves `uvx` and the Godot project on the machine that runs it, and
   contributes one system-prompt section reporting, per declared server, whether its launcher
   was found. Connecting, tool naming, reconnection and result projection stay the shipped
   bridge's job.
2. **The server list is a canonical kit file, projected to the harness home.**
   `profile/mcp-servers.json` is copied to `$DSH_HOME/mcp-servers.json`. This required adding
   the home root as a projection destination in `installFiles()`, because a file outside that
   inventory is never written to a machine — the change would otherwise look applied while
   doing nothing.
3. **The row is written to the home patch layer by a script that imports the plugin's own
   builder.** `scripts/dsh-mcp-sync.mjs` imports `buildRow` and `renderPatch` from the
   plugin, so the spec format and the row shape cannot drift between the reader and the
   writer. The home layer is used rather than a profile layer because one row then serves
   every profile.
4. **The sync refuses a patch layer it does not own, and writes nothing.** It rewrites the
   file only when every top-level element already carries the deployment's row id. On any
   other shape — foreign entries, a mapping, unparseable text — it reports the path and exits
   non-zero. Merging YAML would need a parser this script deliberately does not carry, and a
   merge that guessed at indentation would destroy the other writer's entries.
5. **Provisioning is tooling code that downloads through Node.** Measured on this machine,
   `curl`, `git`, `choco`, `winget` and the `irm | iex` uv installer all fail because the OS
   TLS stack answers `SEC_E_NO_CREDENTIALS`, while Node's own TLS stack reaches every source
   needed. The provisioner verifies `uv`'s published `.sha256`; for the Godot 4.7.2 archive
   upstream publishes **no** checksum, so only the size is compared, and that difference is
   recorded as a residual rather than presented as verification.
6. **`kit-update --apply` runs the sync last and reports rather than throws.** A launcher
   missing on one machine is a fact about that machine; it must not leave the rest of the
   convergence unrecorded.

## Reasoning

The full reasoning — every measured fact, the refused alternatives and the residuals — is in
`docs/ratchet/sources/2026-09-25-transportable-godot-mcp-support.md`, whose hash this record
pins. In summary: implementing MCP was refused because a second client would diverge from the
shipped one exactly where correctness is hard; a hand-written row was refused because it
gives the addon version pin no home a check can compare and because a malformed
`cordis.patch.yml` breaks the whole patch layer; mounting the bridge from the plugin's
`apply()` was refused because it would move the bridge's connection lifecycle into this module
and make an optional server a boot dependency; and a YAML merge was refused because a
hand-rolled merge that gets indentation wrong destroys the human's own configuration.

## Consequences

- A converged machine gets the launch row, the projected spec, the launcher resolution and an
  honest status report. It does **not** get the engine, the `uvx` binary or the committed
  editor addon automatically; those are provisioning and project content, and the kit names
  the exact command instead of pretending to have run it.
- `$DSH_HOME/cordis.patch.yml` now has two possible writers. The failure mode is a named
  refusal carrying the path, not a silently lost entry.
- A machine without `uv` loses the Godot tools and keeps every other feature, because
  `failOnStartupError` is false. The loss is visible in the prompt section and in the sync
  report.
- Adding or changing a server still needs a harness restart, because the row is read at boot.
- The engine archive is not cryptographically verified on this platform, because upstream
  publishes nothing to verify it against.
