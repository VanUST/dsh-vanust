# @cc/dsh-codex-signin

The ChatGPT Plus/Pro (OpenAI Codex) device-code sign-in, outside the web GUI.

The harness pi-ai adapter registers an OAuth flow for the credential key
`llm-pi-ai/openai-codex`, but the web Models page offers only API-key editors.
This plugin exposes three tools to the **orchestrator** preset:

- `codex_signin_start` - starts the flow in the background and returns the
  verification URL and user code as soon as the provider issues them. Pass
  `force: true` to re-authenticate over an existing grant.
- `codex_signin_status` - pending (with the same URL/code), authorized,
  cancelled, failed, or idle. Falls back to the stored grant after a restart.
- `codex_signin_cancel` - withdraws the running attempt; a new start is
  accepted afterwards.

The grant is written by the pi-ai flow through `ctx.credentials`; this plugin
never reads, returns or logs an access or refresh token.

## Flow

1. `codex_signin_start` -> `https://auth.openai.com/codex/device` plus a code.
2. Open the page, sign in with the ChatGPT account that has Plus/Pro, enter the code.
3. `codex_signin_status` -> `authorized`; the `openai-codex` route now answers.

If the provider answers 404 for device authorization, the flow falls back to a
browser URL; the tool returns that URL without a code and status still reports the
attempt.
