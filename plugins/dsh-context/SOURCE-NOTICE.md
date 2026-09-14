# `@cc/dsh-context` — source of the shipped 0.1.2 tarball

## Read this before editing

**These files are a RECONSTRUCTION, not the original build tree.** They were
extracted verbatim from `plugins/cc-dsh-context-0.1.2.tgz`. The project that owns
this package is not on this machine, is not on npm (`npm view @cc/dsh-context`
answers 404), and left no build configuration here, so the original authoring
sources — almost certainly TypeScript, given the shipped `.d.mts` declarations —
are not available.

What that means concretely:

- The files here are **byte-identical to what ships**. Editing one and repacking
  changes the deployed plugin, so the loop works.
- The original build (whatever transpiled TypeScript into these `.mjs` files) is
  **gone**. `plugins/cc-dsh-context-*.tgz` therefore also carries
  hand-reconstructed content rather than a rebuild of the authoring source.
- Do not describe a change here as "the package's source" without that caveat.
  A reader who assumes this is the owning project's tree will make wrong
  assumptions about build steps that do not exist.

## Why it is here at all

The kit's own rule (`AGENTS.md`) says `cc-dsh-context` is *copied from its owning
project*, and that is still the correct arrangement when that project is
reachable. It became unworkable for the one change the ratchet work needed: a
shipped plugin cannot be corrected at all if its only source is a tarball on a
machine nobody here can access. The alternative was to leave a known defect in
place, which the deployment's own rules forbid.

**If the owning project is reachable again, it owns this package.** Port any
change made here back to it, rebuild there, and replace the tarball from that
build. The kit's copy then reverts to being a shipping artifact, which is what it
should be.

## Repacking

The kit pins an exact tarball hash in `$DSH_HOME/.dsh-kit-state.json`, and
`scripts/kit-update.mjs` compares content hashes rather than version numbers, so a
repack MUST be accompanied by a version bump — an unchanged version is served
from the profile lockfile and the new bytes never land (kit hard rule 6).

```bash
# from the kit root
node scripts/pack-dsh-context.mjs          # bumps the patch version, repacks, prints the new hash
```

The packer refuses to overwrite an existing tarball with the same version, and it
reports the resulting sha256 so the change can be committed with its evidence.

**Repacking is not byte-reproducible.** `npm pack` and `tar` both produce a
different archive from the same input (verified: neither matches the shipped
`483448c7…`), so the tarball's identity is its content, never its bytes. The
kit's converger already works that way — it verifies *installed* bytes against the
tarball rather than comparing archives — so nothing depends on reproducibility,
but do not claim a rebuild is verifiable by hash comparison alone.

## What is changed relative to the shipped 0.1.2

| File | Change |
|---|---|
| `context-core.mjs` | `noManifest()` no longer cites `docs/specs/README.md`, a file nothing installs. It names the manifest's fields itself, so the message is self-contained. |
| `package.json` | version bump per repack |

This is the one defect from the ratchet brief's Part IV that is both unambiguous
and self-contained: **R8 — its own instructions cite a file that does not exist.**
The message violated the deployment's rule that inline, user-visible text must be
self-contained.

Every other Part IV defect (R1–R7, R9–R11) is addressed by `@cc/dsh-ratchet`,
which replaces this package's reconciliation role with a strict compiled-decisions
model rather than patching prose matching. See `docs/RATCHET-V2-DESIGN.md`.
