# @cc/dsh-run-code-projection

Bound one `run_code` result: keep a head, a tail and a path to the rest, instead of re-sending
tens of kilobytes on every later step.

A program that prints a report, a JSON page or a whole file hands the model one
`tool/result` of 8–50 KB, and the loop re-sends that result in every subsequent request
until compaction rewrites it. The evidence is usually in the beginning and the end; the
middle is what makes the step expensive. This plugin replaces such a result with:

```
[run-code-projection] 27380 bytes; showing the first 3062 chars and the last 1506 chars, 22772 bytes elided from the middle.
Full text: /home/you/workspace/.dsh/spill/run_code-call_00_N2I4YMAgAKyOuSQJsXDo0908-1794491656594.txt

<first 3062 characters of the output>

[... 22772 bytes elided from the middle; the full text is the file named above ...]

<last 1506 characters of the output>
```

Nothing is lost: the full text is written **inside the session workspace** before the
banner is returned, and the model reads it back with the ordinary file tools when it needs
the middle. A projection that cannot save at least `minSavingRatio` of the original is not
made at all.

Measured on the real fixture in `proof/` (a `run_code` result from this machine's session
log, call `call_00_N2I4YMAgAKyOuSQJsXDo0908`): **27 200 → 4 897 characters (82.0% saved)**;
a 41 208-character result goes to 4 915 characters (88.1%).

## The seam

`tools/post-execute` is the waterfall that may replace a successful tool result's
model-facing `content`; the registry dispatches it at
`@deepseek-ai/dsh-tools/lib/index.js:3600` (`ctx.waterfall(…, 'tools/post-execute', exec,
result, …)`) and applies the `accept`/`block` decision in `postExecute`
(`:3597-3642`). The contract is declared in `dsh-tools/lib/types/index.d.ts:70`. `run_code`
renders exactly one text block (`dsh-tools/lib/index.js:1244`), which is what this policy
replaces.

The listener awaits `next()` first, so any policy that blocks the call, replaces its
`value`, or replaces its `content` stays authoritative; the projection only rewrites the
content that would otherwise reach the model.

## Configuration

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` registers no listener. |
| `minBytes` | `8192` | shortest result worth projecting (bytes). |
| `headBytes` | `3072` | retained prefix, cut on a UTF-8 boundary. |
| `tailBytes` | `1536` | retained suffix, cut on a UTF-8 boundary. |
| `minSavingRatio` | `0.25` | skip unless this fraction of the original bytes is saved. |
| `maxSpillBytes` | `8388608` | larger results are left untouched (no banner without a file). |
| `spillDir` | `.dsh/spill` | directory under the session workspace for the full text. |

Head and tail cuts use `@deepseek-ai/dsh-output-retention`'s `TextRetainer`, so a cut can
never introduce a replacement character or a lone surrogate in the durable log.

## What is never touched

- any tool other than `run_code`;
- a failed result (`isError`), and a decision that blocks or replaces `value`;
- content that is not exactly one text block (images, media, multi-block results);
- a result below `minBytes`, or one whose projection would not save `minSavingRatio`;
- an aborted call;
- content that already starts with the banner (idempotent: a second pass creates no file);
- a session with no workspace `cwd` — there would be nowhere legitimate to put the text.

## Failure containment

The spill file is written **before** the banner is returned. If the write or `mkdir`
fails, the result is returned untouched and the failure is logged once per kind: a banner
naming a file that does not exist would be worse than a long result. The listener's own
work is wrapped; a projection failure can never turn a successful tool call into an error.

## Proof

```
node plugins/run-code-projection/proof/proof.mjs
```

It drives the plugin's real `tools/post-execute` listener against a real `run_code` result
(fixture extracted read-only from `$DSH_HOME/sessions` with `zstd -dc`), a temporary
directory standing in for the session workspace, and prints before/after characters. It
then feeds the projection back (idempotency), and checks every untouched case: short,
error, image, other tool, aborted, blocked, value-replaced, no workspace, unwritable spill,
insufficient saving. Exit code 0 is the pass.
