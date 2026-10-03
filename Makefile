# dsh-kit — one-command tasks.
#
# `make` is NOT required to use this kit: every target here is a thin alias for a `node`
# command you can also run directly. It exists because one task is genuinely multi-step and
# machine-dependent — find the usage export, find this platform's download folder, unzip it,
# name the report — and one memorable alias beats four steps that differ on Windows and Linux.
#
# All logic lives in scripts/usage-from-downloads.mjs, so nothing here depends on a shell
# feature. That matters: the recipe must behave the same under sh, bash and cmd.exe.

.DEFAULT_GOAL := help

.PHONY: help usage usage-print verify

help:
	@echo "make usage        newest usage export in Downloads -> docs/usage/<YYYY-MM>.html, opened"
	@echo "make usage-print  the same, printed to the terminal instead of opened"
	@echo "make verify       run every check the kit ships"
	@echo ""
	@echo "Overrides:"
	@echo "  make usage DOWNLOADS=/some/dir"
	@echo "  make usage ZIP=/path/usage_data.zip"
	@echo "  make usage OUT=docs/usage/2026-10.html"
	@echo "  make usage NOOPEN=1        write the report without opening a browser"

# One command end to end: scan, extract, redaction-check, write the report, open it.
usage:
	node scripts/usage-from-downloads.mjs $(if $(DOWNLOADS),--downloads "$(DOWNLOADS)") $(if $(ZIP),--zip "$(ZIP)") $(if $(OUT),--out "$(OUT)") $(if $(NOOPEN),--no-open,)

# The same run, printed rather than opened: if you are reading it in the terminal, a browser
# window is not wanted.
usage-print:
	node scripts/usage-from-downloads.mjs --print --no-open $(if $(DOWNLOADS),--downloads "$(DOWNLOADS)") $(if $(ZIP),--zip "$(ZIP)") $(if $(OUT),--out "$(OUT)")

# Every check the kit ships, in the order the deployment documents them.
# The test list is a make-time wildcard, not a hand-written list: a hand-written one silently
# skips whatever a later change adds, which is the failure mode this target exists to prevent.
verify:
	node scripts/check-portability.mjs
	node scripts/check-instruction-routing.mjs
	node scripts/check-model-gate.mjs
	node scripts/check-test-quality.mjs --root . --strict
	node --test $(wildcard scripts/test-*.mjs)
	node scripts/probe-dsh-api.mjs --kit-rules
	node scripts/probe-dsh-api.mjs --specs-prompt
