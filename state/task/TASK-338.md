---
id: TASK-338
kind: task
title: "Project hygiene: one working guide, durable docs, legacy audit, orchestrator proposals"
status: done
revision: 3
createdAt: 2026-11-27T11:27:21.730Z
updatedAt: 2026-11-27T11:38:51.121Z
acceptance:
  - text: "docs/GUIDE.md exists, is linked from README, and covers layout, tools/presets, deployment, verification, traps and the orchestrator proposals"
    done: false
  - text: "no dated audit/handoff/proof/plan remains in docs/ and no surviving file or code comment cites a removed one"
    done: false
  - text: "reports/legacy-audit.md names removed and kept candidates with the reference search behind each"
    done: false
  - text: "make verify and make test are green on the final tree"
    done: false
boardId: task-mwywctxr-bgaic6
inline: true
nonScope: ["No change to plugin behaviour, the profile's runtime rows, or the deployment procedure's rules", "No commit: the tree also carries another workstream's uncommitted designmap/panel work", "No deletion of state/, docs/cases/, docs/analysis/ or designmap pages (project ledgers, not runtime docs)"]
reqIds: [REQ-265, REQ-266, REQ-267, REQ-268, REQ-269]
resultEvidence: ["make verify exit 0 — 20/20 portability and packaging; documentation ok (every role preset named: 12; every mounted plugin named: 36); README + docs/GUIDE.md are the pin/plugin-count witnesses", "make test exit 0 — 78/78 (59 plugin test files, 1 acceptance file, 18 proof scripts)", "98 tracked files deleted via git rm (66 docs/, 24 scripts/designmap-*, 6 .reasonix/tasks, USERGUIDE.md, design.excalidraw); untracked runtime removed: .cache 296M, .playwright-mcp 5.9M, .a5c 812K, .usage-analysis 564K, server.pid", "dangling-reference scan after fixes: no doc or code comment cites a removed file (only fixtures/examples and historical records docs/cases + docs/analysis)", "reports/legacy-audit.md: plugin dirs 29 = inventory rows 29 = tarballs 29, versions match package.json; work-modes deliberately unmounted; 4 unreferenced scripts documented in GUIDE §2.2; README retired @cc/dsh-design-map bullet removed", "docs/GUIDE.md §10 records the orchestrator proposals (5 deterministic + 3 prompt rules) with cost and owner decision"]
resultSummary: "Проект причёсан: один рабочий гайд и один владелец у каждого факта. `docs/GUIDE.md` (новый, ~30K) описывает карту репозитория, инструменты и 12 пресетов, принципы выкатки и проверки, правила разработки, измеренные сегодня ловушки и предложения для оркестратора; `README.md` стал входной точкой с картой документации. Удалена runtime-документация: 66 файлов в docs/ (audits, handoffs, review, usage, design, designmap-evidence, PTC/PLUGIN-PROOFS/CONTEXT-ECONOMY, HARNESS-OVERVIEW, USERGUIDE и CASE-LIBRARY-DESIGN), 24 файла designmap-спайков, 6 файлов .reasonix/tasks, старый design.excalidraw и неотслеживаемые кэши (.cache 296M, .playwright-mcp, .a5c, .usage-analysis). Все ссылки на удалённое обновлены (README, правила, installers, case-design, comments, check-documentation, check-portability). Аудит легаси: 29 каталогов = 29 строк inventory = 29 тарболов с совпадающими версиями; 4 полезных скрипта без ссылок задокументированы, а не удалены; README больше не описывает снятый @cc/dsh-design-map. Отчёт с доказательствами: reports/legacy-audit.md. Предложения оркестратору (FR4) записаны в GUIDE §10: 5 детерминированных (mount-proof, rule-owners scan, role-alias test, case re-link, read-guide gate) и 3 промптовых, с ценой и решением владельца."
scope: ["docs/GUIDE.md (new), README.md, USERGUIDE.md, docs/ durable set, rules/DEPLOYMENT.md references", "deletion of tracked runtime docs under docs/", "reference updates in scripts, profile comments and plugins (comments only)", "reports/legacy-audit.md (evidence report, gitignored)"]
steps: ["Analysis Record project-hygiene-guide-and-docs with requirements and documentation ownership", "Write docs/GUIDE.md (layout, tools/presets, deployment, verification, traps, orchestrator proposals)", "README: entry point and doc map; remove duplicated setup/procedure prose", "Delete runtime docs; update every reference (README, case design, scripts, taskboard comments)", "Legacy audit: plugins vs inventory vs profile, scripts, root artefacts; remove the safe ones, list the rest", "Orchestrator proposals for the defect class (costed, enforcement vs prompt)", "Run make verify and make test; record evidence and close"]
stepsDone: 7
---

Give the repository one working guide and one owner per fact: write docs/GUIDE.md, make README the entry point, delete the runtime documentation (dated audits, handoffs, proofs, plans, old measurements), fix every reference, run the tree gates, audit the codebase for junk/legacy with evidence, and propose the orchestrator guards for the defect class measured today.
