---
id: TASK-481
kind: task
title: "Собрать батч к одному перезапуску: outline, политика, профиль"
status: done
revision: 5
createdAt: 2026-11-28T16:18:40.639Z
updatedAt: 2026-11-28T16:55:51.075Z
boardId: task-mx0m7atb-q808vn
chore: true
choreReason: "Накопился батч: outline починен и должен вернуться в профиль, политика оркестратора изменена (порог, условные глаголы), профиль получил fetchProvider."
nonScope: ["Не перезапускать сервер и не запускать apply — это шаг владельца.", "Не менять правила политики по существу: только сборка и коммит."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит dcab579: 48 файлов, +1060/−73 — профиль, исходники оркестратора и outline, тест шима, оба новых пакета и удаления старых, кейс outline, состояние.", "pack-plugin: orchestrator 0.1.83 → 0.1.84 (sha256 a9ed1292…), outline 0.1.5 → 0.1.6 (sha256 fdae2dca…), прежние tgz удалены.", "Проверки после коммита: presets 147 строк 0 отказов, documentation ok, boundaries gate ok, identity-guard patched, make verify exit 0 (20/20 portability, tarball:matches-source PASS).", "kit-update --check --json: plan = write-profile-files: cordis.patch.yml + install-plugins: orchestrator 0.1.84, outline 0.1.6."]
resultSummary: "Батч собран и закоммичен (dcab579): outline включён обратно в профиль, fetchProvider сохранён, пакеты orchestrator 0.1.84 и outline 0.1.6 пересобраны, make verify зелёный, план kit-update содержит только профиль и два пакета."
role: DEVOPS
scope: [profile/cordis.patch.yml, packages/, plugins/outline/package.json, plugins/orchestrator/package.json]
---

Собери и закоммить батч так, чтобы один перезапуск владельца применил всё. Сделай: (1) в profile/cordis.patch.yml верни outline в работу — убери enabled: false (или поставь true) и поправь комментарий, объясняя, что причина устранена в плагине; оставь fetchProvider: http; (2) подними версию и пересобери пакеты оркестратора (изменилась политика) и outline (починка запуска), удали прежние tgz; (3) прогони проверки схем пресетов, документации, границ и make verify, приложи коды; (4) закоммить профиль, плагины, пакеты, кейс outline и состояние; (5) приложи план kit-update: в нём должны быть только установка пакетов и запись профиля. Сервер не перезапускай.
