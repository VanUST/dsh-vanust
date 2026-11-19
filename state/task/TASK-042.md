---
id: TASK-042
kind: task
title: "Research: existing tools/plugins that fit each DSH role"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.466Z
updatedAt: 2026-11-17T15:52:39.466Z
acceptance:
  - text: "Every candidate has a URL that was actually fetched in this session and a last-release/maintenance signal"
    done: false
  - text: "Each entry names the integration path in DSH terms (mcp-servers.json entry or the exact CLI command) and a one-line verdict: adopt / maybe / reject"
    done: false
  - text: "Nothing already shipped in DSH is proposed again; rejections say why (dead, licence, needs paid key, duplicates an installed tool)"
    done: false
  - text: "The report is at most 200 lines and ends with a single ranked 'top 8 by value/cost' list"
    done: false
  - text: "The final message summarises the picks in <=15 lines and names the file"
    done: false
boardId: task-mwan6yq0-b408mh
nonScope: ["no edits to any file except .dsh/research/role-tooling.md", "no installs, no config changes, no plugin work - this is research only", "do not touch plugins/, profile/, rules/, scripts/ or the uncommitted scripts/session-store.mjs", "no paid SaaS that needs a private API key unless it also has a free/local mode", "no generic advice ('use Lighthouse') without the exact package, URL and integration command"]
owner:
  kind: agent
  label: RESEARCH
  sessionId: b814419b-19e4-4dd2-b8fc-e4d82dcc91c0
ownerRole: RESEARCH
role: RESEARCH
scope: ["web_search and web_fetch of official project pages, GitHub repos, npm and MCP server listings", "write exactly one report file: /home/iustimov/dsh-kit/.dsh/research/role-tooling.md", "read the installed harness docs under /home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*/README.md to see what DSH already ships"]
sessions:
  - sessionId: b814419b-19e4-4dd2-b8fc-e4d82dcc91c0
    label: RESEARCH
    role: RESEARCH
    status: sleeping
---

Produce a verified shortlist of EXISTING tools that fit six agent roles in the DeepSeek Harness (DSH), including the integration path for each (MCP server, CLI the agent runs, npm package, or skill). The human explicitly asked "поищи в интернете" for these roles and for the system-map plugin, so breadth matters, but every entry must be verified by fetching its page. Do not recommend anything already shipped in DSH.

Migrated from .dsh/taskboard.json (task task-mwan6yq0-b408mh, revision 6).
