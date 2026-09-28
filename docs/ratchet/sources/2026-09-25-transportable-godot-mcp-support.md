# Transportable Godot MCP support for agent workspaces

Reasoning captured while giving this deployment a Godot editor connected to an agent, and
making that connection travel between machines rather than being configured per machine.
Every fact below was measured on this machine or read from the named upstream source.

## The ask

Install the latest Godot for the current game project, connect a Godot MCP server to the
harness, and make that connection **transferable through the workspaces of other machines**.
The user chose `hi-godot/godot-ai` as the server, directed that the plugin be added to the
kit rather than hand-configured per machine, and directed that the current folder
(`C:\projects\berceuse`, an art/design repository with no `project.godot`) also become the
Godot project.

## Measured before anything was designed

**The harness already contains an MCP client bridge.** `@deepseek-ai/dsh-mcp-client`
`0.1.5-rc.2` is installed inside the harness tree with an `@modelcontextprotocol/sdk`
dependency, and exports `{ Config, apply, inject, name }`. Its README states the whole
configuration surface: one entry per server, `serverName`/`transport`/`command`/`args`, and
tools published as `mcp__<serverName>__<tool>`. A grep of the harness `lib/` for `mcp`
returned nothing and no `*mcp*` directory existed in the profile, which is why the bridge
first appeared absent; it was found by listing the installed `@deepseek-ai/*` packages. A
plugin that implemented MCP would therefore duplicate a shipped, tested component.

**The bridge resolves from the profile although it is not mounted.** With the working
directory set to `C:\Users\1\.dsh\profiles\web`,
`require.resolve('@deepseek-ai/dsh-mcp-client')` returned the harness-tree path through the
profile's `.dsh-module-fallback`. No new profile dependency is needed for an `insert` row to
load it, and no such row exists today.

**Godot was not installed anywhere**, and `godot` was not on PATH.

**Godot latest stable is 4.7.2** (18 August 2026), from `godotengine.org/versions.json`. 4.8
exists only as `dev6` snapshots. The chosen server requires Godot **4.7+**, so 4.6.x would
not have satisfied it.

**The machine's OS TLS stack is broken; only Node's works.** This governed the whole
install. `curl`, `git` and `choco` all fail with `schannel: AcquireCredentialsHandle failed:
SEC_E_NO_CREDENTIALS (0x8009030E)`, and `winget --version` prints nothing. From the same
shell, Node's `fetch` returned 200 for `registry.npmjs.org`, `api.github.com`, `github.com`
and `pypi.org`, and `npm ping` returned `PONG`. So `Invoke-WebRequest`, `curl`, `choco`,
`winget` and the standalone `irm … | iex` uv installer are all the BROKEN path, and a
provisioner built on any of them fails silently on this machine.

**The chosen server is editor-live.** `hi-godot/godot-ai` 4.2.3 (24 September 2026, MIT)
drives a **running Godot editor** over `MCP client → godot-ai attach (stdio) → Python server
(:8000) → editor plugin (WebSocket :9500)`, with rotating capabilities on both local hops.
It needs `uv`/`uvx` and a committed addon at `<project>/addons/godot_ai/`.

**The server supports this harness natively.** Its `docs/client-configuration.md` documents
a dedicated DSH strategy and the exact mechanism: DSH "has no `mcp` CLI verb. MCP servers
register as `@deepseek-ai/dsh-mcp-client` plugin entries in the HOME patch layer
`$DSH_HOME/cordis.patch.yml` (applies over every profile, web GUI included). New servers
must be added as `insert` rows — a plain `- id:` row only overrides an existing bundle id and
is skipped with a warning… The entry's launch nests under `config`
(`serverName`/`transport`/`command`/`args`); `serverName` is the model-facing tool
namespace", and "requires `transport` next to command fields, rejects `url` next to them".
The row shape adopted here therefore has an independent upstream confirmation, and
`mcp__<server>__<tool>` is the harness's own contract rather than a convention invented
here.

**The connection was proven before it was wired.** Driving the exact configured argv over
stdio returned `serverInfo: {"name":"Godot AI attach","version":"4.0.5"}` to `initialize`
and **47 tools** to `tools/list`, including `session_activate`, `editor_state`,
`editor_screenshot`, `scene_get_hierarchy` and `logs_read`. `godot-ai --version` and
`godot-ai attach --version` both report `4.2.3`, so the package pin is truthful and the
`4.0.5` is the bridge's own protocol version string, not the installed version.

## What the kit must therefore provide

The user's requirement is that the kit supply everything needed to use the Godot MCP, so the
list below is the acceptance criterion rather than a design sketch. A machine that has
converged must have, or be able to create, all five:

1. **The bridge, mounted.** An `insert` row naming
   `@deepseek-ai/dsh-mcp-client` with the Godot server's launch, written to
   `$DSH_HOME/cordis.patch.yml`, which the harness applies over every profile.
2. **A launcher.** `uvx`, resolved on the machine that runs it.
3. **The engine.** Godot 4.7+, and the committed editor addon the server is the other half
   of.
4. **The dependency, projected.** The canonical server list, at
   `$DSH_HOME/mcp-servers.json`.
5. **An honest status.** A way to tell, on this machine, whether the tools are actually
   loadable rather than merely declared.

## The decisions, and what each refused alternative cost

### 1. Load the shipped bridge; do not implement MCP

Refused: an MCP client in the new plugin. The bridge's naming pins, atomic generation swap,
reconnect budget, environment scrubbing and result projection are already fixed by its own
tests; a second implementation would diverge exactly where correctness is hard. The plugin
is therefore reduced to the three things the bridge does not do: own the canonical list,
resolve `uvx`, and know the Godot project directory.

### 2. The kit owns the server list, and a spec rather than a hand-written row

Refused: a hand-written `insert` row in `profile/cordis.patch.yml`. It would carry a version
pin that must track the committed addon, with nothing comparing the two, and a malformed
`cordis.patch.yml` breaks the whole patch layer at boot. A JSON spec lets the plugin refuse a
bad list with a named reason while leaving the rest of the composition working, and gives the
pin one home that a check can compare.

Refused: keeping the list on the machine, which is where a UI's "Configure" writes it. That
is per-machine configuration, not transferability, and it is the specific outcome the user
asked to avoid.

### 3. The row is written to the HOME layer, by a script that imports the plugin's builder

The loader reads a declarative row, so the plugin is not what mounts the server — but the
plugin is what knows how to build the row, and `scripts/dsh-mcp-sync.mjs` imports
`buildRow`/`renderPatch` from it. One module owns the spec format and the row shape, so the
reader and the writer cannot drift.

Refused: mounting the bridge from inside this plugin's `apply()`. That would give this module
ownership of the bridge's connection lifecycle, disposal and hot-swap semantics, all of which
the harness loader already implements from a row, and would make an optional MCP server a
boot-time dependency of the composition.

Refused: merging into an existing `$DSH_HOME/cordis.patch.yml`. Merging YAML requires a
parser this script deliberately does not carry, and a hand-rolled merge that gets indentation
wrong destroys whatever else the operator keeps there. The script therefore rewrites the file
only when every element already carries its own row id, and otherwise writes nothing and
names the path. Godot AI's own dock writes that file when a human presses Configure, so a
human who does so will see the next sync refuse rather than silently lose their entries —
which is the honest failure.

### 4. Provisioning is kit code, and it speaks to the network through Node

Because no OS-TLS downloader works here, the toolchain is provisioned by a script that
downloads through Node. Every artifact is verified against a digest upstream publishes, and
finding those digests is part of the job: `godotengine.org/versions.json` carries none, but
the GitHub release for 4.7.2 ships `SHA512-SUMS.txt`, which lists
`Godot_v4.7.2-stable_linux.x86_64.zip` and matches the downloaded archive (measured
2026-09-28). `uv` publishes a `.sha256` for each asset. The Godot AI addon publishes no
`.sha256` beside `godot-ai-v4-plugin.zip` — the `.sha256` asset that release does carry
belongs to the v3 archive, `godot-ai-plugin.zip` — so its digest is read from
`godot-ai-v4-plugin.manifest.json`, whose `asset.sha256` matches the archive. Reading the
wrong sidecar first is what produced an "unverified" report for an archive whose digest had
in fact been published.

Two defects found by running it rather than reading it, recorded because both were silent:
`$LASTEXITCODE` read after a consuming assignment reports the wrong command's status, so a
working install was reported missing; and Godot's Windows release is a **GUI-subsystem**
binary whose stdout is unreliable (measured: one invocation printed the version, five
returned nothing), which is why it ships a `_console.exe` — the probe now prefers that
wrapper.

## Residuals, stated so they are not mistaken for guarantees

1. `uv` is a hard dependency for the Godot tools. `failOnStartupError` is deliberately
   false, so a machine without it loses those tools and keeps every other feature; the loss
   is reported in the prompt section and in the sync output rather than hidden.
2. The dock/kit dual-writer conflict on `$DSH_HOME/cordis.patch.yml` is mitigated by a
   refusal and a message, not by a mechanism: the sync will not merge, so the operator must
   choose.
3. The addon is committed project content that the project must maintain; the package pin
   and the addon must share a major version, and a mismatch surfaces as a bridge refusal.
4. The engine archive IS cryptographically verified on this platform, through the release's
   `SHA512-SUMS.txt`. The addon is verified through its release manifest rather than a
   digest sidecar, so a release that dropped the manifest would leave that artifact
   unverified rather than checked.
5. A new or changed server needs a harness restart: the row is read at boot.
6. The declared server's tool definitions enter every request while it is mounted. The cost
   is bounded by the server's tool count (47 at the version pinned here) and by nothing this
   change controls.
