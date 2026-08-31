#!/usr/bin/env bash
# Easy startup for the dsh web GUI (Linux/macOS).
set -euo pipefail
DSH_HOME="${DSH_HOME:-$HOME/.npm/dsh}"
export DSH_HOME
exec dsh web --port "${PORT:-3080}"
