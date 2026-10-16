---
title: Log-Driven Development
slot: rules
order: 120
status: active
---
## 1. Log-Driven Development (LDD)

Logs are the source of truth for the system's state. Decide whether a task succeeded by
reading the success logs it produced, never by the code having compiled or exited without
throwing.

- **Analyzable output.** Every generated log is structured — JSON or clear key-value pairs —
  so a later step can parse it.
- **State transparency.** Log entry and exit of critical functions, parameter state before and
  after each transformation, and the exact failure point in every `try`/`catch`.
- **Safe and bounded.** Logging must not crash on a null or undefined value, and must not
  flood a tight loop: sample or aggregate before writing.
