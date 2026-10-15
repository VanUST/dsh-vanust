# Session size, context growth and compaction in dsh

**Written:** 2026-09-12 · **Harness:** `@deepseek-ai/dsh@0.1.5-rc.1` · **Profile:** `web` on this
machine · **Measured with:** `scripts/session/session-report.mjs`, which reads the stored session logs.

> ## Status: a dated snapshot, verified 2026-10-15
>
> This file is kept for its reasoning and its reproduction recipe, not as a statement about the
> machine today. Its figures were taken from **eight sessions** on a single day; the machine now
> holds **1,020** (118 driven directly, 902 subagent) and the same techniques over all of them give
> different numbers. Re-derive any figure you intend to act on:
>
> ```bash
> node scripts/session/session-report.mjs      # per-session curve, cache share, compaction events
> ```
>
> **What still holds, re-measured 2026-10-15 over all 1,020 sessions:** cumulative prompt tokens are
> a cost meter, not a context size (33.58 B summed, 99.23% of it cache reads, 257 M billed); a long
> history does not itself raise cost per step (§4); and the largest single-step billed input — not
> the cumulative counter — is the figure that costs money.
>
> **What no longer holds — corrected below:** the claim that no session on this machine has ever
> compacted. §3 is amended in place because it is the one stale claim an agent would otherwise act
> on; the rest of the file is left as written on its date.

---

This file answers a question that came from reading the GUI, not from reading code: *a session shows
hundreds of millions of tokens — what is that number, and does a long session degrade the agent?*
Every figure below was measured on this machine's own sessions and is reproducible with the command
named beside it.

---

## 1. What the big number is

The GUI counter is **cumulative across requests, not a context size**. Two mechanisms explain it.

**Every step sends the whole conversation.** The prompt for request *N* is the system prompt, tools,
every earlier user and assistant message, and every tool result — the session prefix is not trimmed
between steps. So the prompt grows with every step of every turn.

**A session with many steps therefore reports a large sum.** Measured on the two long sessions here
(`node scripts/session/session-report.mjs`):

| Session | Requests | Prompt: first → last | Summed prompt tokens | Cached share |
|---|---|---|---|---|
| `session-2a36eb1a…` | 645 | 13,270 → **701,763** | **256,571,294** | 99.8% |
| `session-0c0aee56…` (this conversation) | 333 | 8,622 → 370,386 | 64,174,703 | 99.4% |

Across all eight sessions on this machine: **986 requests, 321,197,793 prompt tokens, 320,377,600 of
them cache reads (99.7%), 820,193 billed input tokens.**

So ">500M tokens" is reachable in a session of ~600 steps: 600 steps × a ~500K prompt ≈ 300M, and the
same session counted across a few days reaches 500M+ without any single context being large. The
largest actual context observed here is **701,763 tokens**, which is 70% of the routed model's
declared window.

## 2. Why it is affordable: the provider's prefix cache

DeepSeek prices a cache-read input token far below an uncached one, and the harness is built so
almost every token in a growing prompt is a cache read: the prompt of step *N+1* is the prompt of step
*N* plus its new tail, so the provider can serve the unchanged prefix from cache. That is why a 701K
prompt costs a fraction of what re-sending 701K uncached tokens would.

**The cost event is a cache miss, and its size scales with the prompt.** The same measurement shows
exactly that: `session-0c0aee56` had three steps with under 50% cache hit, the worst billing
**178,310 uncached input tokens in one step**; `session-2a36eb1a` never dropped below 50% and its
worst single step billed 26,054. Anything that rewrites the front of the prompt — an edited system
prompt, a changed tool list, a compaction, a retried attempt after `llm/retry-started` — invalidates
the prefix and re-bills the whole prompt at the uncached rate.

Practical consequences:

- Long sessions are cheap *while the prefix is stable*. Cost per step is roughly the new tail plus the
  cached prefix, so it grows slowly rather than linearly with history.
- A prompt-sized cache miss on a 700K context is a ~700K-token full-price event. This is the thing to
  watch, and the reason a session that "feels" cheap can produce one expensive step.
- Compaction is therefore not free either: it rewrites history, so the first request after it pays a
  fresh prompt (the plan reports "estimated tokens freed", but the next step is a cache miss).

## 3. Compaction: what dsh has, and what this profile runs

The machinery exists and is well built:

| Component | Role |
|---|---|
| `@deepseek-ai/dsh-token-meter` | replay-based pressure measurement; `measure()` prices the current surface; `contextPressure` projection carries the newest provider-reported prompt size, projected next-request cost and the context window |
| `@deepseek-ai/dsh-compaction-basic` | automatic condensation as pressure approaches `thresholdRatio × contextWindow` (default 0.8), overflow-only recovery after a provider-confirmed `CONTEXT_WINDOW_EXCEEDED`, an on-demand `/compact`, and a recent tail kept verbatim (`retainRatio` 0.16 by default). Pressure is checked on `agent/pre-step`; the summary call replays the warm prefix so the auxiliary call is itself mostly cached |
| `@deepseek-ai/dsh-command-compact` | the `/compact` command wrapper |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | trims oversized tool outputs before condensation |
| `@deepseek-ai/dsh-spill-policy` | keeps oversized tool results out of context entirely: above `maxInlineBytes` (**50,000** in this profile) a result becomes a bounded head/tail preview plus a locator, with the full text behind the spill backend |

**In this profile none of the condensation paths are active** — that was measured on 2026-09-12 in
a session with no condensation. The composed tree marks `compaction-basic`, `command-compact` and
`tool-result-pruner` all `disabled: true`, patched by `@deepseek-ai/dsh-web-app`. Nothing else in the
tree provides compaction: a directory scan finds only those packages.

> **Correction, measured 2026-10-15.** Compaction **is** running here: **817 events across 35
> sessions** in the full corpus, and the session log identifies them directly
> (`compaction/start`, `compaction/summary`, `compaction/prune`, `compaction/end`). The original
> scan found none because those records are absent from the two long sessions it read — a session's
> log records condensation only if condensation happened in it.
>
> Two consequences, both measured:
>
> - **The trigger sits between 0.68 and 0.79 of the window.** The peak prompt of the 35 compacted
>   sessions clusters in two groups — 14 of them at 673,715–678,781 tokens and 19 at
>   784,267–801,969 — against a catalog window of 1,000,000. That peak is an upper bound on the
>   trigger rather than the trigger itself, so read the ratio as a band. Contexts are being bounded
>   by compaction after all, which mitigates the "silent cliff at an over-stated window" concern in
>   §5.2; what is NOT explained is why two bands exist, and which band a session lands in is worth
>   checking before tuning a threshold.
> - **Compaction is not free.** It rewrites the prompt prefix, so the next request re-bills the
>   whole context uncached: 60 steps over 50 K uncached tokens each, **19.9 M tokens — 15% of all
>   uncached spend**, versus 66% for new turns arriving after the prefix cache expired. 11 of the
>   35 compacted sessions end below half their peak prompt; the other 24 grew again after
>   compacting.
>
> The recommendation in §5.1 therefore changes: the question is no longer whether to enable
> compaction, but **where the trigger belongs** given that each one costs a full re-bill, and
> whether a fresh session is cheaper than compacting a ~680 K one.

> **Corrected 2026-10-15 (this paragraph, and the section above, were written from a scan that
> missed compaction).** The threshold trigger, the overflow retry and `/compact` are **running**, and
> 817 events are recorded across 35 sessions. The reasoning below is retained for its historical
> value and is superseded by the correction above: a session IS bounded by condensation, and the
> recovery path for a provider-confirmed `CONTEXT_WINDOW_EXCEEDED` does exist here.
>
> The original paragraph, as written on 2026-09-12:
>
> > So the mechanism that keeps a session working near the limit — the threshold trigger, the
> > overflow retry, `/compact` — is off in the web profile, and everything rests on the model's
> > declared context window (`contextWindow: 1000000` in the profile's `llm-deepseek` catalog). The
> > 701,763-token prompt is observed fact; the window is a catalog value. If they ever disagree, the
> > failure is a `CONTEXT_WINDOW_EXCEEDED` request error with **no recovery path in this profile**
> > (recovery lives in `compaction-basic`'s `agent/request-error` listener, which is disabled).


Two smaller things worth keeping in view:

- The pruner is what bounds *tool output* inside context; with it off, only `spill-policy`
  (`maxInlineBytes: 50000`) keeps a single huge command output from entering context at all.
- `@deepseek-ai/dsh-token-meter` **is** mounted, so the measurement surface a fix would need already
  exists.

## 4. Does a long session make the agent worse?

Separate the three things that "worse" can mean, because only two are measurable here.

**Cost per step — grows with the tail, not with history.** Cached prefix reads are cheap; each step's
billed input was 100–5,000 tokens in this session, with the outliers being cache misses. History
length itself does not make a step more expensive.

**Latency — grows with prompt size.** Unchanged prefix tokens are not re-computed by the provider, but
they are carried and attended over, so time-to-first-token rises with context. This is not measurable
from the session log (it has no per-step timestamps for first token), so treat it as *unverified
here*: the mechanism is known, the magnitude on this deployment was not measured.

**Quality — not measurable from this log, and this is the honest answer.** Whether a 700K-token
context degrades the model's attention to the instructions is a property of the model, not of dsh, and
nothing in the harness measures it. What the harness does provide is the ability to *avoid* the
question: a fresh session with a summary, or letting compaction bound the growth. (This sentence
said "`compaction-basic` (disabled here)"; it runs, see §3.) The deployment's own rules already lean
that way — rule 3 pushes facts into `.dsh/project.json` and tools rather than into a growing
conversation, which is exactly the "don't carry it in context" strategy.

**The failure mode that is real and recorded:** `assistant/attempt` in this session's log records a
`TRANSPORT` failure — `DeepSeek API request to https://api.deepseek.com failed` — at step 136 of a
turn. That is a transport error, not a context-length error, but it is the kind of event that becomes
more likely with very large prompts and long sessions. The re-measurement agrees about the magnitude
and not about the cause: transport failures are the **single largest reliability defect in the
corpus** — 26,696 retries across 84% of sessions, 13,230 of them `TRANSPORT` — and 47 steps over
50 K uncached tokens follow a retry, **13.4% of all uncached spend**. Compaction provides a recovery
path for the context-length variant, so that specific cliff is closed.

## 5. What to do about it

> **Amended 2026-10-15.** Items 1 and 4 rested on compaction being off, which the corpus disproves
> (§3). The originals are kept below so the change of advice is visible rather than edited away.
>
> 1. **Where the compaction trigger belongs, not whether.** Compaction runs here, firing at
>    0.68–0.79 of the window. Each firing costs a full prompt re-bill (~20 M tokens over the
>    corpus, 15% of uncached spend), so the question is whether a threshold in that band is the
>    right trade against starting a fresh session, whose cost is a handover document rather than a
>    re-read.
> 2. **Confirm the model's real context window** against the provider's documentation rather than
>    trusting `contextWindow: 1000000` in the catalog. The largest prompt observed across the whole
>    corpus is now **801,969 tokens**, and an over-stated catalog value is a silent cliff.
> 3. **Watch the cache-miss events, not the cumulative counter** — unchanged and confirmed. The
>    counter is a sum of cache reads (33.58 B of 33.84 B, 99.23%) and looks alarming while being
>    nearly free. `scripts/session/session-report.mjs` prints the largest single-step billed input
>    per session, which is the number that costs money; over the corpus the largest is **794,545
>    uncached tokens in one step**.
> 4. **Start fresh sessions when the task changes** — still good advice, for a different reason.
>    Compaction now bounds a session, so a new session is no longer the *only* reset; it is the
>    cheaper one, because it avoids the re-bill that a compaction triggers. The deployment's
>    `.dsh/project.json` + `context_*` tools exist to make that reset cheap: the facts live in the
>    repository, not in the conversation.

<details>
<summary>The 2026-09-12 recommendations, as written</summary>

1. **Decide deliberately about compaction in the web profile.** Either enable
   `compaction-basic` (+ its pruner) with a threshold below the real window, or accept
   "sessions are bounded by the model window" knowingly. Today it is off by an upstream bundle
   choice, not by a decision of this deployment's — and the profile patch is the place to change it.
2. **Confirm the model's real context window** against the provider's documentation rather than
   trusting `contextWindow: 1000000` in the catalog. At 701,763 tokens observed, an over-stated value
   is a silent cliff.
3. **Watch the cache-miss events, not the cumulative counter.** The counter is a sum of cache reads
   and looks alarming while being nearly free. `scripts/session/session-report.mjs` prints the
   largest single-step billed input per session, which is the number that costs money.
4. **Start fresh sessions when the task changes.** Given compaction is off, a new session is the only
   context reset available, and the deployment's `.dsh/project.json` + `context_*` tools exist to make
   that reset cheap: the facts live in the repository, not in the conversation.

</details>

## Appendix — reproducing every figure

```bash
# per-session record mix, prompt curve, cache share, compaction events
node scripts/session/session-report.mjs
node scripts/session/session-report.mjs --session <path> --verbose
node scripts/session/session-report.mjs --home <DSH_HOME>
```

The shared reader (`scripts/session/session-log.mjs`) documents the two format traps this measurement
had to solve: the session file is a concatenation of independent zstd frames (one per append; a
one-shot decompression returns only the first frame and reports no error), and provider token
accounting hangs off `assistant/message` records rather than the request header.

Figures quoted here were taken 2026-09-12 from eight sessions totalling 986 requests; the two long
sessions are named above so the same numbers can be re-derived from the same logs.
