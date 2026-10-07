# dsh-kit — one-command tasks.
#
#   make usage                          newest export in ~/Downloads, then open the page
#   make usage EXPORT=path/to/usage.zip  a specific export
#   make usage NO_OPEN=1                 write the reports without opening a browser
#   make usage REPORT_DIR=somewhere      where the reports land
#   make usage-check                     the redaction gate: fail if a report would carry identity material
#   make test-usage                      the analytics' own test suite
#   make verify                          every check the kit ships
#
# The work is done by Node, not by this file: locating the export, parsing it,
# computing the figures and opening the browser all live in scripts/ so the same
# behaviour is available on either platform and is covered by tests. This file is
# the thin alias on top.

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

.PHONY: help usage usage-check test-usage notify-selftest verify

help:
	@echo "make usage                    - newest usage export in ~/Downloads, write and open the report"
	@echo "make usage EXPORT=<path.zip>  - a specific export"
	@echo "make usage NO_OPEN=1          - write the reports without opening a browser"
	@echo "make usage-check              - the redaction gate; exit 1 when a report would carry identity material"
	@echo "make test-usage               - run the analytics test suite"
	@echo "make verify                   - run every check the kit ships"

usage:
	@$(NODE) $(ANALYTICS) $(EXPORT_ARG) $(OPEN_ARG)

# The gate as a target: the reader drops the identity columns, and the reporter re-reads
# its own output before anything is written, so this fails when a key, an account id or a
# credential header would reach a page. `--check` writes nothing.
usage-check:
	@$(NODE) scripts/usage-analytics.mjs --check $(EXPORT_ARG)

test-usage:
	@$(NODE) --test scripts/test-usage-analytics.mjs

# Raise one REAL notification on this host, in the top-right corner of the display the human
# is on (not the Xvfb a server usually inherits). Not part of `verify`: it pops a window on
# the machine running it, which is evidence when you ask for it and noise when you do not.
# `--style daemon` uses the desktop's own mechanism instead, for comparison.
notify-selftest:
	@$(NODE) scripts/notify-selftest.mjs

verify:
	node scripts/check-portability.mjs
	node scripts/check-instruction-routing.mjs
	node scripts/check-model-gate.mjs
	node scripts/check-test-quality.mjs --root . --strict
	node --test $(wildcard scripts/test-*.mjs)
	node plugins/presentation/test-render.mjs
	node plugins/presentation/test-tool.mjs
	node scripts/probe-dsh-api.mjs --global-specs
	node scripts/probe-dsh-api.mjs --local-specs
