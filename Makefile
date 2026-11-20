# dsh-kit — one-command tasks.
#
#   make usage                          newest export in ~/Downloads, then open the page
#   make usage EXPORT=path/to/usage.zip  a specific export
#   make usage NO_OPEN=1                 write the reports without opening a browser
#   make usage REPORT_DIR=somewhere      where the reports land
#   make usage-check                     the redaction gate: fail if a report would carry identity material
#   make verify                          every check the kit ships
#
# The work is done by Node, not by this file: locating the export, parsing it,
# computing the figures and opening the browser all live in scripts/ so the same
# behaviour is available on either platform. This file is the thin alias on top.

NODE       ?= node
REPORT_DIR ?= reports/usage
EXPORT     ?=
NO_OPEN    ?=
# `--out-dir` names each report after the window the export covers, so a month's
# artifacts share one name instead of whichever label the caller remembered.
ANALYTICS  := scripts/usage-analytics.mjs --out-dir "$(REPORT_DIR)"
ifeq ($(strip $(EXPORT)),)
EXPORT_ARG :=
else
EXPORT_ARG := --export "$(EXPORT)"
endif
ifeq ($(strip $(NO_OPEN)),)
OPEN_ARG := --open
else
OPEN_ARG :=
endif

# The spend gate's thresholds. MAX_PEAK_SHARE defaults to the script's own default
# (0.25); MAX_LEGACY_PREMIUM defaults to 0, meaning ANY premium paid for a retired
# model name fails, because a retired alias bills above the rate card that replaced it.
# Set either to empty to skip that check.
MAX_PEAK_SHARE ?= 0.25
MAX_LEGACY_PREMIUM ?= 0
GATE_ARG := --no-agent-hours
ifneq ($(strip $(MAX_PEAK_SHARE)),)
GATE_ARG += --max-peak-share $(MAX_PEAK_SHARE)
endif
ifneq ($(strip $(MAX_LEGACY_PREMIUM)),)
GATE_ARG += --max-legacy-premium $(MAX_LEGACY_PREMIUM)
endif

# The session corpus and the statistics cut from it. Under .cache/ because both are derived and
# large (the corpus is ~65 MB): regenerable from the logs, never a source of truth themselves.
CORPUS   ?= .cache/session-analysis/corpus.json
ANALYSIS ?= .cache/session-analysis/analysis.json

.PHONY: help usage usage-check usage-gate session-corpus session-analysis notify-selftest session-doctor session-identity harness-guard harness-guard-apply verify test cases

help:
	@echo "make usage                    - newest usage export in ~/Downloads, write and open the report"
	@echo "make usage EXPORT=<path.zip>  - a specific export"
	@echo "make usage NO_OPEN=1          - write the reports without opening a browser"
	@echo "make usage-check              - the redaction gate; exit 1 when a report would carry identity material"
	@echo "make usage-gate               - the spend gate; exit 1 when peak share or retired-name premium exceeds the cap"
	@echo "  EXPORT=<path.zip>, MAX_PEAK_SHARE=<0..1>, MAX_LEGACY_PREMIUM=<usd>"
	@echo "make session-corpus           - one pass over every session log -> $(CORPUS) (~2 min)"
	@echo "make session-analysis         - the corpus, then the behaviour and cost figures cut from it"
	@echo "make session-doctor           - report session logs the OS refuses to read (the UI shows no history)"
	@echo "make session-identity         - report stored messages with no identity (they refuse the whole session)"
	@echo "make harness-guard            - check the harness patch that makes that class impossible (3 = unpatched)"
	@echo "make verify                   - run every check the kit ships (they READ the tree)"
	@echo "make test                     - run the tests that RUN the kit: plugin tests, then proof scripts"
	@echo "  ONLY=<substring>            - run only the test and proof paths containing it"
	@echo "make cases                    - execute the automated cases in docs/cases; exit 1 when one is not verified"
	@echo "  TAG=<tag> ARGS=<cli args>   - e.g. make cases TAG=benchmark, or ARGS=\"--id <case>\""

usage:
	@$(NODE) $(ANALYTICS) $(EXPORT_ARG) $(OPEN_ARG)

# The gate as a target: the reader drops the identity columns, and the reporter re-reads
# its own output before anything is written, so this fails when a key, an account id or a
# credential header would reach a page. `--check` writes nothing.
usage-check:
	@$(NODE) scripts/usage-analytics.mjs --check $(EXPORT_ARG)

# The SPEND gate, as a command rather than a sentence in a report. The analytics has
# always computed the peak premium and the retired-name premium and then exited 0; this
# is what makes those figures fail a build. Deliberately NOT part of `verify`: it needs an
# export that a fresh clone does not have, and a check that cannot run on the machine
# running it is worse than one that runs where the export lives.
#   make usage-gate EXPORT=~/Downloads/usage_data_2026-09-01_2026-09-30.zip
# Fails today: that export carries a 41.6% peak share and $19.81 of retired-name premium.
usage-gate:
	@$(NODE) scripts/usage-analytics.mjs $(EXPORT_ARG) $(GATE_ARG)


# The other reason the UI can look wiped when every byte is on disk: dsh aborts the whole
# cross-workspace session listing on any error it does not recognise as corruption, so ONE
# unreadable log (an on-access scanner returning EPERM is the local case) costs the history
# and the New Session button. `start.sh` runs the guard's `ensure` automatically; this is the
# report-only half - it moves nothing and exits 1 when something is refused, so it can be a
# check as well as an answer.
session-doctor:
	@$(NODE) scripts/session-store.mjs doctor

# The defect class the doctor cannot see: a stored message with no identity, which refuses the
# whole session at load. `scan` is the check (exit 1 while a log needs repair, moves
# nothing); `repair --apply` rewrites the affected frames with a backup and verifies the
# result before it replaces the original.
session-identity:
	@$(NODE) scripts/session-repair.mjs scan

# The defense that makes the class impossible rather than repairable: the harness patch that
# stamps an identity when an event is written and repairs a legacy one when it is read. Exit 3
# means the installed harness is unpatched - `make harness-guard-apply` (or any boot: the
# dsh wrapper converges it) and it comes back.
harness-guard:
	@$(NODE) scripts/harness-identity-guard.mjs --check

harness-guard-apply:
	@$(NODE) scripts/harness-identity-guard.mjs --apply

# Raise one REAL notification on this host, in the top-right corner of the display the human
# is on (not the Xvfb a server usually inherits). Not part of `verify`: it pops a window on
# the machine running it, which is evidence when you ask for it and noise when you do not.
# `--style daemon` uses the desktop's own mechanism instead, for comparison.
notify-selftest:
	@$(NODE) scripts/notify-selftest.mjs

# Report (default) or install the external binaries the features use.
provision:
	@$(NODE) scripts/provision-tools.mjs --check

provision-apply:
	@$(NODE) scripts/provision-tools.mjs --apply


# UI design audit — a SEPARATE target, never part of `verify`: verify must stay offline, while
# this needs the provisioned impeccable engine (and may scan a URL). Output is one JSON document.
design-audit:
	@$(NODE) scripts/design-audit.mjs

verify:
	node scripts/check-portability.mjs
	node scripts/check-documentation.mjs
	node scripts/check-glossary.mjs
	node scripts/schema-lint.mjs
	node scripts/context-budget.mjs
	node scripts/harness-identity-guard.mjs --check

# The other half of the gate. The checks above READ the tree - paths, packaging, documentation,
# schema bytes, session headers - and none of them executes it. This target runs the files that
# do: every plugin test file through `node --test`, then every proof script, one process each,
# in a fixed order, stopping at the first failure with exit 1. `make test ONLY=taskboard` runs a
# subset. It is a separate target on purpose: `verify` stays the cheap reader that needs no
# session store and no browser.
test:
	@$(NODE) scripts/test-all.mjs $(if $(strip $(ONLY)),--only "$(strip $(ONLY))",)

# The case library's own entry point. `make verify` is the packaging/doc gate; this target RUNS
# the product: every automated case (or a TAG/ARGS subset) is executed by the same runner the
# host tool uses, the measured result is written back, and a case that is not verified exits 1.
# Artifacts land under docs/cases/runs/ (gitignored).
cases:
	@$(NODE) plugins/test-cases/bin/cases.mjs suite $(if $(TAG),--tag $(TAG),) $(ARGS)

# The session corpus: one pass over every stored session log (~2 min for ~1,000 logs), producing a
# single JSON the questions can be answered from in seconds instead of re-reading ~1 GB of zstd on
# every ask. `session-report.mjs` stays the per-session view; this is the corpus view.
session-corpus:
	@$(NODE) scripts/session/extract-corpus.mjs --out "$(CORPUS)"

# The behavioural and cost statistics cut from that corpus: how asks are framed, where steps go,
# which tool calls fail, where the cache-miss money is.
session-analysis: session-corpus
	@$(NODE) scripts/session/analyse-corpus.mjs --corpus "$(CORPUS)" --json "$(ANALYSIS)"
	@echo "analysis: $(ANALYSIS)"
