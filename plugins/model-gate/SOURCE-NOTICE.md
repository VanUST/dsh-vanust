# `@deepseek-ai/dsh-model-gate` — read-only source snapshot

## Read this before editing

**These files are a READ-ONLY SNAPSHOT of the plugin's authoring source**, copied
verbatim from a DeepSeek Harness checkout. They are here so a reader can review what
the plugin does; the shipped artifact is the tarball, and this directory is not what
produces it.

| Fact | Value |
|---|---|
| Upstream repository | `https://github.com/deepseek-ai/deepseek-harness.git` |
| Package path | `packages/host/model-gate` |
| Ref | tag `dsh-v0.1.5-rc.1` (commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`) |
| Snapshot commit | `9041f8dbb88f7444495bce9c833851f3301b1f6e` (one commit after the tag) |
| Package version | `0.1.5-rc.1` |
| License | MIT (Copyright (c) 2026 DeepSeek); see the repository `NOTICE` |

What is included: `src/index.ts`, `tests/gate.spec.ts`, `package.json`,
`tsconfig.json`, `README.md`, and the upstream `LICENSE` (MIT, Copyright (c) 2026
DeepSeek), which the MIT terms require to travel with the source. What is excluded:
`lib/` (the compiled output that the tarball actually ships) and `node_modules/`. The
`package.json` dependencies use the harness workspace protocol (`workspace:^`) and do
not resolve from this directory; that is expected, because nothing here is executed.

## This is not the build tree

`plugins/model-gate-*.tgz` is built by `scripts/rebuild-plugins.sh`, which builds from
a harness checkout pinned to the installed harness version. Editing a file in this
directory changes nothing that ships: the next rebuild overwrites it. A behaviour
change belongs upstream, followed by a re-copy of the snapshot, a version bump in the
harness package, and a rebuild.

## Refreshing the snapshot

1. In a harness checkout, `git checkout` the ref the kit's installers pin.
2. Re-copy the five files listed above over this directory.
3. Update the `ref` and `commit` rows in the table, and `source.commit` in
   `plugins/inventory.json`.
4. Rebuild the tarball with `scripts/rebuild-plugins.sh` and re-run the gate.
