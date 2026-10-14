# dsh-kit — one-command tasks.
#
#   make usage                          newest export in ~/Downloads, then open the page
#   make usage EXPORT=path/to/usage.zip  a specific export
#   make usage NO_OPEN=1                 write the reports without opening a browser
#   make usage REPORT_DIR=somewhere      where the reports land
#   make usage-check                     the redaction gate: fail if a report would carry identity material
#   make verify                          every check the kit ships
#   make connect-usb-device              tunnel the harness to a USB-attached phone
#   make connect-usb-device OPEN=1       ... and open the page on the phone
#
# The work is done by Node, not by this file: locating the export, parsing it,
# computing the figures and opening the browser all live in scripts/ so the same
# behaviour is available on either platform. This file is the thin alias on top.

NODE       ?= node
REPORT_DIR ?= reports/usage
EXPORT     ?=
NO_OPEN    ?=
PORT       ?= 3080
OPEN       ?=
DEVICE     ?=
STATE_DIR  ?=

# `adb reverse` asks the PHONE to forward a port over the cable to the same port here, so the
# phone's browser reaches this machine's loopback interface. The bridge's trust fence already
# trusts loopback, so USB needs no `--trusted-host` and exposes nothing to any network.
USB_ARGS   := --port $(PORT)
ifneq ($(strip $(DEVICE)),)
USB_ARGS   += --device "$(DEVICE)"
endif
ifneq ($(strip $(OPEN)),)
USB_ARGS   += --open
endif
ifneq ($(strip $(STATE_DIR)),)
USB_ARGS   += --state-dir "$(STATE_DIR)"
endif

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

.PHONY: help usage usage-check notify-selftest verify connect-usb-device

help:
	@echo "make usage                    - newest usage export in ~/Downloads, write and open the report"
	@echo "make usage EXPORT=<path.zip>  - a specific export"
	@echo "make usage NO_OPEN=1          - write the reports without opening a browser"
	@echo "make usage-check              - the redaction gate; exit 1 when a report would carry identity material"
	@echo "make verify                   - run every check the kit ships"
	@echo "make connect-usb-device       - tunnel the harness to a USB-attached phone (PORT=<n>, default 3080)"
	@echo "make connect-usb-device OPEN=1 - the same, and open the page on the phone"
	@echo "  PORT=<n> (default 3080), DEVICE=<serial>, STATE_DIR=<path> to find the pairing code"

usage:
	@$(NODE) $(ANALYTICS) $(EXPORT_ARG) $(OPEN_ARG)

# The gate as a target: the reader drops the identity columns, and the reporter re-reads
# its own output before anything is written, so this fails when a key, an account id or a
# credential header would reach a page. `--check` writes nothing.
usage-check:
	@$(NODE) scripts/usage-analytics.mjs --check $(EXPORT_ARG)

# Raise one REAL notification on this host, in the top-right corner of the display the human
# is on (not the Xvfb a server usually inherits). Not part of `verify`: it pops a window on
# the machine running it, which is evidence when you ask for it and noise when you do not.
# `--style daemon` uses the desktop's own mechanism instead, for comparison.
notify-selftest:
	@$(NODE) scripts/notify-selftest.mjs

# Reach the chat bridge from a phone over the USB cable, with nothing exposed to any network.
# The script does the diagnosis and names the ONE action a human must take when it cannot
# connect, because "it did not work" is the expensive part of a cable that needs a dialog
# accepted on the phone.
connect-usb-device:
	@$(NODE) scripts/connect-usb-device.mjs $(USB_ARGS)

verify:
	node scripts/check-portability.mjs
	node scripts/check-instruction-routing.mjs
	node scripts/check-model-gate.mjs
	node scripts/probe-dsh-api.mjs --global-specs
	node scripts/probe-dsh-api.mjs --local-specs
