---
id: TASK-273
kind: task
title: "Codex sign-in tool: codex_signin_start/status/cancel"
status: open
revision: 1
createdAt: 2026-11-22T06:45:28.423Z
updatedAt: 2026-11-22T06:45:28.423Z
acceptance:
  - text: "codex_signin_start returns verification URL + user code within 10 s and keeps the flow running in the background"
    done: false
  - text: "codex_signin_status reports pending with the same code, then authorized/cancelled/failed"
    done: false
  - text: "codex_signin_cancel withdraws the attempt; a second start while pending returns ALREADY_IN_FLIGHT with the current link/code; after cancel a new start works"
    done: false
  - text: "No access/refresh token or other secret appears in tool output, state, or logs; missing authorization service is a named refusal"
    done: false
  - text: "The three tools are registered only for the orchestrator preset; unit tests use fake authorization services and make no network calls"
    done: false
  - text: "Plugin packed, profile row added, inventory/docs updated, check-portability and check-documentation pass"
    done: false
boardId: task-mwrh32dq-l6e3xh
inline: true
reqIds: [REQ-111, REQ-112, REQ-113, REQ-114]
steps: ["Read ctx.authorization API and existing plugin patterns", "Implement plugin state machine and three tools with fake-service tests", "Add profile row, inventory entry, docs; pack tarball", "Run unit tests, check-portability, check-documentation", "Install into the live kit and restart so the tools are mounted; then start a real sign-in"]
stepsDone: 0
---

Implement the missing host plugin @cc/dsh-codex-signin so the orchestrator can start the ChatGPT Plus/Pro device-code login from chat, receive the verification URL and user code, poll status, cancel/retry, and have the pi-ai flow commit the llm-pi-ai/openai-codex grant. No token or refresh secret may appear in tool output or logs.
