---
id: TASK-250
kind: task
title: "Основание задачи в delegate_task и остановка install.ps1 на сбойном шаге"
status: done
revision: 9
createdAt: 2026-11-19T14:32:07.789Z
updatedAt: 2026-11-19T15:19:14.251Z
acceptance:
  - text: "delegate_task с reqIds и с chore+choreReason создаёт по одной строке и запускает по одному ребёнку; вызов без основания возвращает req_required без строки и без ребёнка"
    done: false
  - text: "сообщение отказа несёт объяснение таскборда, совет освободить строку есть только при board_full"
    done: false
  - text: "proof-скрипт на orchestrator.mjs и install.ps1 из git HEAD завершается 1 (red), на рабочем дереве — 0 (green)"
    done: false
  - text: "install.ps1 проверяет $LASTEXITCODE после npm config set prefix, npm install -g и corepack pnpm add и завершается ненулевым кодом при сбое"
    done: false
  - text: "make verify завершается 0; тесты plugins/orchestrator зелёные; тарбол оркестратора совпадает с исходником"
    done: false
boardId: task-mwnnfmxh-5o3muk
inline: true
nonScope: ["plugins/taskboard: правило req_required не меняется", "живой сервер :3080 и установленный профиль не перезапускаются и не перенастраиваются", "контекстные лимиты из третьего пункта ревью не трогаются: сначала измерение стоимости", "docs/TERMINOLOGY.md не расширяется: новых понятий работа не вводит"]
reqIds: [REQ-148, REQ-149, REQ-150]
resultArtifacts: [reports/delegation-basis-and-install-steps/p1.log, reports/delegation-basis-and-install-steps/p2.log, reports/delegation-basis-and-install-steps/db-green.log, reports/delegation-basis-and-install-steps/db-red.log, reports/delegation-basis-and-install-steps/is-green.log, reports/delegation-basis-and-install-steps/is-red.log, reports/delegation-basis-and-install-steps/verify-final2.log, docs/analysis/delegation-basis-and-install-steps.json]
resultEvidence: ["node scripts/delegation-basis-proof.mjs → 13/13 exit 0 (reqIds и chore+choreReason стартуют по одному ребёнку, вызов без основания — req_required без строки и ребёнка, отказ без 'Free a row', board_full с ним)", "node scripts/delegation-basis-proof.mjs --orchestrator reports/delegation-basis-and-install-steps/orchestrator.mjs (git HEAD) → 4/13 exit 1: reqIds и chore получают req_required, отказ советует освободить строку", "node scripts/installer-steps-proof.mjs --ps1 reports/delegation-basis-and-install-steps/head-install.ps1 → VERDICT refused, exit 1, три шага без проверки (70, 74, 88); без аргументов → VERDICT accepted, exit 0 (88→89, 93→94, 108→109)", "node --test scripts/test/installer-steps.test.mjs → 5/5 exit 0; CASE_NEGATIVE_CONTROL=expect-pre-fix → exit 1; node --test plugins/orchestrator/test/delegation-basis.test.mjs → 8/8 exit 0, control exit 1", "make verify → exit 0: 18/18 portability and packaging ([PASS] install-ps1:mandatory-step-exit, tarball:matches-source), documentation ok, glossary ok", "node scripts/analysis-before-decomposition-proof.mjs → 138/138 exit 0 (путь delegate_task не сломан); node --test plugins/orchestrator/test/policy-gating.test.mjs → 5/5", "node scripts/pack-plugin.mjs --dir plugins/orchestrator → cc-dsh-orchestrator-0.1.62.tgz sha256 48b534beb87480e177246fb9e249236e45ccad2c5e33b7242c65c41b899ecf9e, старый 0.1.61 удалён"]
resultSummary: "Делегирование снова запускает субагента без выдуманного требования, а установщик Windows останавливается на сбойном обязательном шаге. delegate_task объявляет и передаёт в доску основание задачи (reqIds/reqId либо chore+choreReason), при отказе возвращает объяснение доски, а совет освободить строку оставляет только для board_full; в политику делегирования добавлена строка про основание. install.ps1 получил функцию Assert-Step ($LASTEXITCODE + exit 1) после npm config set prefix, npm install -g и corepack pnpm add. Доказательства: red/green proof-скрипты на коде из git HEAD и на рабочем дереве, тесты с негативным контролем, гейт check-portability:mandatory-step-exit, make verify exit 0, тарбол оркестратора 0.1.62 совпадает с исходником."
scope: ["plugins/orchestrator/orchestrator.mjs: параметры delegate_task, передача основания в taskboard.create, сообщение отказа, строка политики делегирования", "install.ps1: функция Assert-Step и проверки кода возврата после обязательных внешних команд", "scripts/lib/installer-steps.mjs и scripts/check-portability.mjs: гейт проверки установщика", "scripts/delegation-basis-proof.mjs: red/green proof делегирования", "plugins/orchestrator/test: тест на основание задачи", "plugins/cc-dsh-orchestrator-*.tgz: перепаковка после правки"]
steps: ["Расширить delegate_task: параметры reqIds/reqId/chore/choreReason, передача в taskboard.create, сообщение отказа с объяснением доски", "Назвать основание задачи в политике делегирования корня", "Добавить Assert-Step и проверки кода возврата в install.ps1", "Написать scripts/lib/installer-steps.mjs, подключить в check-portability.mjs", "Написать scripts/delegation-basis-proof.mjs и тест основания задачи в plugins/orchestrator/test", "Красный прогон на коде из git HEAD, зелёный на рабочем дереве", "make verify и тесты плагина orchestrator, перепаковка тарбола, запись анализа, закрытие задачи"]
stepsDone: 7
---

Корневой агент должен запускать субагента на ревью без выдуманного требования, а установщик Windows — не рапортовать об успехе после сбоя обязательного шага. Для этого delegate_task объявляет и передаёт таскборду основание создаваемой задачи (reqIds/reqId либо chore+choreReason) и возвращает объяснение таскборда при отказе, оставляя совет освободить строку только для board_full; install.ps1 проверяет $LASTEXITCODE после каждой обязательной внешней команды и завершается с ненулевым кодом. Работа доказывается прогоном на коде до правки (red) и после (green), гейтом check-portability.mjs и make verify.
