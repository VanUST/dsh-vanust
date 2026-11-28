---
id: TASK-515
kind: task
title: "TESTER: браузер из .tools вместо схем в контексте"
status: done
revision: 5
createdAt: 2026-11-28T20:35:38.486Z
updatedAt: 2026-11-28T21:07:04.458Z
boardId: task-mx0vdrs4-9qque0
chore: true
choreReason: "Роль TESTER не знает, что браузер и axe уже установлены в .tools кита: из-за этого приёмка интерфейса осталась документированной, хотя инструменты лежат на диске."
nonScope: ["Не менять allow-список инструментов роли.", "Не перезапускать сервер."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["profile/cordis.patch.yml:2162 — в персону TESTER добавлен абзац: UI-кейс гоняется настоящим браузером, библиотеки лежат в <kit>/.tools (playwright-core, axe-core, @axe-core/playwright, pixelmatch), драйвер — скрипт под docs/cases/drivers, запускается node.", "Число инструментов роли не изменилось: 28 до и после; mcp__playwright__* остался в deny — схемы в контекст не добавлены.", "Поправлены два комментария профиля, говорившие «без браузера» (:432 и :606).", "check-preset-configs exit 0 (147 строк), check-documentation exit 0, schema-lint exit 0, check-glossary exit 0, check-prompt-playbooks exit 0."]
resultSummary: "Роль TESTER теперь знает, что браузер и axe лежат в .tools: persona описывает драйвер с playwright-core без единой браузерной схемы в контексте, число инструментов роли осталось 28."
role: DEVOPS
scope: [profile/cordis.patch.yml, rules/DEPLOYMENT.md]
---

Сделай так, чтобы роль TESTER знала про браузер, который уже лежит на диске. В <kit>/.tools установлены playwright-core, axe-core, @axe-core/playwright и pixelmatch — этим UX/UI уже меряет панель, а тестировщик не нашёл и записал кейс документированным. Сделай: (1) допиши в персону роли TESTER две строки: UI-кейс гоняется настоящим браузером, библиотеки лежат в <kit>/.tools (playwright-core, axe-core, @axe-core/playwright, pixelmatch), драйвер — скрипт под docs/cases/drivers и запускается node с этими библиотеками; (2) если в rules/DEPLOYMENT.md сказано, что у роли нет браузера, поправь строку так же; (3) прогони проверки пресетов и правил, приложи коды и число инструментов роли (оно меняться не должно). Верни: что дописано, где, коды, число инструментов до и после.
