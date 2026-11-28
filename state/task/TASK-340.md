---
id: TASK-340
kind: task
title: "Свести дерево: пересобрать оркестратор и доказать причёсывание документации прогонами"
status: done
revision: 5
createdAt: 2026-11-27T12:28:53.244Z
updatedAt: 2026-11-27T12:49:02.896Z
acceptance:
  - text: "node scripts/pack-plugin.mjs --dir plugins/orchestrator ran and its output quotes the bumped version (0.1.76 -> 0.1.77), the tarball path and the sha256."
    done: false
  - text: "node scripts/check-documentation.mjs exits 0 and its output includes the PASS line \"the development rules have one owner\" with \"6 rule(s)\" (or the file's own wording) and the final \"documentation ok\"."
    done: false
  - text: "make verify exits 0; quote the last lines of its output."
    done: false
  - text: "make test runs green, or a named subset of it does with the reason the rest did not run; quote the command, the tail of the output and the exit code."
    done: false
  - text: "No surviving file outside state/, docs/cases/ and docs/analysis/ cites a path that reports/legacy-audit.md lists as removed: quote the search command and its empty result."
    done: false
  - text: "Every relative link in README.md and docs/GUIDE.md resolves to an existing file; quote the check."
    done: false
  - text: "A final git status --short and git diff --stat, so the orchestrator sees exactly which files the run touched."
    done: false
boardId: task-mwyyjv7v-sg4fqz
nonScope: ["Do NOT edit the ROOT_POLICY text in plugins/orchestrator/orchestrator.mjs, docs/GUIDE.md §8/§9, or scripts/check-documentation.mjs — those were just made in TASK-339; if one of them looks wrong, report it instead of editing.", "Do NOT run node scripts/kit-update.mjs --apply and do NOT restart the dsh web server: the owner applies and restarts by hand.", "Do NOT touch state/, docs/cases/ or docs/analysis/ (project ledgers, not runtime docs)."]
owner:
  kind: agent
  label: DOCS
preset: docs
reqIds: [REQ-265, REQ-266, REQ-269]
resultEvidence: ["pack-plugin: 0.1.76 -> 0.1.77, tarball cc-dsh-orchestrator-0.1.77.tgz, sha256 16ff4012…, EXIT=0; später 0.1.78 (sha256 ffcb59a8…).", "tar -xOzf … | diff - plugins/orchestrator/orchestrator.mjs → IDENTICAL; check-portability 20/20.", "node scripts/check-documentation.mjs → documentation ok, EXIT=0 (на тот момент 5 rule(s); дефект покрытия исправлен в TASK-342, где прогон даёт 6 rule(s)).", "make verify → VERIFY_EXIT=0, 0 строк FAIL/FAILED.", "timeout 900 make test → 80/80 passed in 80280 ms, EXIT=0.", "8 относительных ссылок README разрешаются; поиск удалённых путей в docs/README/AGENTS/оркестраторе пуст.", "git diff --stat: README.md, docs/GUIDE.md, plugins/orchestrator/{orchestrator.mjs,package.json}, scripts/check-documentation.mjs, docs/analysis/*, state/*."]
resultSummary: "Дерево сведено после правки политики: оркестратор пересобран (0.1.77 → позже 0.1.78), tarball байт-в-байт равен source, проверка документации зелёная, make verify exit 0, make test 80/80, восемь относительных ссылок README разрешаются, поиск удалённых путей пуст. Названы и переданы дальше два дефекта: неполное покрытие заявки и номер удалённой версии в тексте правила."
role: DOCS
scope: [plugins/orchestrator/, "plugins/cc-dsh-orchestrator-*.tgz", docs/, README.md, reports/legacy-audit.md]
---

Source of truth: /home/iustimov/dsh-kit. The orchestrator policy text (plugins/orchestrator/orchestrator.mjs, ROOT_POLICY) and docs/GUIDE.md §8 were just edited in another task, and docs/ was pruned earlier today (see reports/legacy-audit.md). Your job is to make the tree consistent and to PROVE the documentation cleanup by running it, not by reading it: repack the orchestrator plugin so the tarball matches its source, then run the documentation claim check, the tree gate and the test gate, and quote each command with its output and exit code. Where a claim in reports/legacy-audit.md can be re-checked cheaply, re-check it. Report what you could not verify.
