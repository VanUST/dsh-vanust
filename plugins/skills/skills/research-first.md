# Research before implementing

Your training data is a snapshot. The library you are about to use has probably shipped two major versions since, the API you remember was renamed, and the pattern you are reaching for was superseded by something simpler. The failure is silent: code written from memory compiles, runs, and is a year behind.

**Memory is a prior, not a source.** When a task did not hand you the answer, go and read the current one before you design or write.

## When this applies

Research first when any of these is true:

- you are about to use a library, framework, API or CLI whose version you have not checked in this session;
- the task is "build X" without a specification of *how* — there are competing approaches and one is current;
- you are about to write a config file, a CI pipeline, an auth flow, a migration, a Dockerfile, a build script;
- something you remember "used to work" and the error suggests otherwise;
- the user asked for the modern or recommended way.

Skip it when the work is local and self-describing: renaming a variable, fixing a typo, following an API that is *in this repository* and documented there. Reading the code you already have beats reading the internet.

## What to look up, in order

1. **The version you are actually on.** `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `--version`. A doc page for the wrong major version is worse than memory.
2. **The official documentation for that version** — the reference page for the specific function or flag, not a tutorial blog.
3. **The changelog or upgrade guide** between your remembered version and that one: this is where renames and removals live.
4. **One worked example** from an authoritative source, so the shape is right before you write the whole thing.
5. Only then, community material — and prefer answers that name a version and a date.

## How to do it here

- `web_fetch` a specific official page. Search endpoints can be unavailable; a URL you already know (docs, `raw.githubusercontent.com`, a changelog) always works.
- If the deployment exposes a documentation MCP (for example **Context7**: `resolve-library-id` then `query-docs`, or the `ctx7 library` / `ctx7 docs` CLI), prefer it — it returns version-matched snippets rather than your recollection.
- Read the local source of truth too: `node_modules/<pkg>/README.md`, `--help`, `man`. The installed code cannot lie about its own version.
- Record what you found **before** writing: the URL, the version, and the one fact that changed your plan. That note is what you cite in the handoff; a research step with no recorded finding tends to be a ritual.

## When a lookup fails

A failed web call is usually **transient**, not unavailable: on this deployment a request commonly fails once or twice and then succeeds. Retry two or three times — with a short pause, not in a tight loop — before concluding that a source cannot be reached. Only after the retries fail should you switch to a URL you know will answer:

| Need | Fetch this |
|---|---|
| Package docs and README | `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/README.md` (and the docs folder beside it) |
| Papers and the state of the art | arXiv API — `http://export.arxiv.org/api/query?search_query=all:<terms>&max_results=10` (Atom XML) |
| Citations and venues | Semantic Scholar — `https://api.semanticscholar.org/graph/v1/paper/search?query=<terms>&fields=title,year,abstract,url` |
| A specific function's contract | the project's docs site, or `node_modules/<pkg>/README.md` for the installed version |
| Whether a release changed an API | the changelog: `<repo>/releases` or `CHANGELOG.md` via raw.githubusercontent.com |

The gate that enforces this rule counts only a lookup that returned real content (it measures the text), so a transient failure is not mistaken for research — retry until one succeeds, then read it and cite what changed your plan.

## The prompt this rule answers

> "Do it the best way, not the way you remember."

Concretely: name the approach you are about to take, state where you read that it is current, and only then write. If the docs contradict your plan, the plan changes — that is the point of looking.

## When you cannot look

Offline, rate-limited, or the source is behind auth: say so, name what you are assuming and from what version, and prefer the most conservative API surface (stable, documented, no experimental flags). Do not silently present a remembered API as current. In deployments that enforce a research step, a waiver exists for exactly this case; use it with the reason, and state the assumption in the result.

## Checklist

- [ ] Version of every external thing I touch is known, not assumed.
- [ ] The API shape came from a page I read in this session, or from the installed package itself.
- [ ] I checked the changelog for removals/renames between remembered and actual versions.
- [ ] The one fact that changed my plan is written down, with its URL.
- [ ] No "recommended" claim is made without a source that is current.
- [ ] If I could not look, the assumption is stated in the deliverable.

## Why this is worth the tokens

One `web_fetch` costs a few hundred tokens. Rewriting an integration because the auth flow changed costs a day. The asymmetry is enormous, and the most expensive failures are not wrong code but *outdated* code that passes review because it looks familiar.

## Sources

Pattern assembled for this deployment from two existing approaches that solve the same problem: [Context7](https://github.com/upstash/context7) (version-specific documentation on demand, MCP or CLI) and the Superpowers skill methodology's rule that relevant skills are checked **before** a task, as mandatory workflow rather than suggestion (<https://github.com/obra/superpowers>).
