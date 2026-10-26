# @cc/dsh-rtk

Command-aware output compression at the seam DSH actually leaves open.

Upstream's Claude Code hook rewrites the command (`git status` -> `rtk git status`).
DSH's `tools/pre-execute` explicitly cannot rewrite arguments, so this plugin filters
the **result** instead. On `tools/post-execute`, for the configured shell tools only, a
single simple command is mapped to an `rtk pipe -f <filter>` filter; when the
model-facing text is at least `minChars` and the filtered replacement is genuinely
smaller, the text block is replaced in place:

```
[rtk: the `git-log` filter replaced 3860 B of shell output with a compact projection; lines may have been elided. Re-run the command unfiltered for the full text, or use `rtk recall <hash>` when a recovery hash appears below.]
39a5407 Make subagent roles persistent and explicit
...
```

(The banner is one line; it is wrapped here for readability.)

Every other case passes through untouched: an unmapped command, a compound one
(`|`, `&&`, `;`, redirects), an `rtk` command, a missing or failing binary, a
non-zero exit, empty output, an abort, non-text content, or a replacement that
would not save bytes. `git status` is the honest example of the last rule: its
filter trims one byte, so the banner would cost more than it saves.

The bash/pwsh tools append `[exit code: N]`, timeout, signal and sandbox markers
after the command's own output. A filter can drop those, so the plugin re-appends
the trailing markers it was about to lose: a failing run cannot read as a
passing one.

## Why the output side

The plugin cannot make `git status` run as `rtk git status`; the harness forbids
argument rewriting before dispatch. The post-execute waterfall can replace the
projection the model reads, and `rtk pipe` reads stdin, so the same filters are
reachable from the result. The system-prompt section tells the agent where the
binary is and that prefixing a command with it is how to take full control.

## Configuration

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` registers neither the section nor the listener. |
| `bin` | `/home/iustimov/.local/bin/rtk` | rtk executable; falls back to a PATH lookup for `rtk`. |
| `shellTools` | `['bash', 'pwsh']` | tool names whose `arguments.command` may be filtered. |
| `minChars` | `1500` | shortest text worth filtering, in characters. |
| `timeoutMs` | `15000` | kill one `rtk pipe` after this long and pass the result through. |

Mapped commands: `git status`, `git diff`, `git log`, `pytest`, `cargo test`,
`go test`, `tsc`, `vitest`, `grep`, `rg`, `find`, `fd`, `mypy`, `ruff check`,
`ruff format`, `prettier`, `phpunit`, `sqlfluff lint` (plus `npx tsc` /
`npx vitest`). Only the filters rtk 1.1.0 accepts are ever passed; anything else
is a pass-through.

## Recall

rtk's pipe-mode filters elide in place (`[+N lines omitted]`, `[more changes
truncated]`) and 1.1.0 does not print a recovery hash for those cases. The banner
says so and tells the model to re-run the command unfiltered; it mentions
`rtk recall <hash>` only as the route when a filter does print a hash. Nothing is
silently presented as complete.

## Proof

```bash
node scripts/rtk-selftest.mjs
```

Runs real commands in this repository through `classifyCommand` + `filterOutput`
and prints, per case, the filter, before/after bytes, the command and rtk exit
codes, and whether it shrank or deliberately passed through. Exit 0 only when
every case matches its expectation.
