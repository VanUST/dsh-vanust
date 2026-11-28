---
id: TASK-439
kind: task
title: "Собрать пакет оркестратора 0.1.83 со швом"
status: done
revision: 5
createdAt: 2026-11-28T13:04:39.106Z
updatedAt: 2026-11-28T13:08:48.235Z
boardId: task-mx0f9sji-aohalc
nonScope: ["Установка в профиль и развёртывание; коммит; правка поведения или тестов."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-296]
resultEvidence: ["pack-plugin: plugins/orchestrator 0.1.82 -> 0.1.83, tarball sha256 6aa10930898adf74a11eac31398bdd719ab0bb4b39cbd8c2fa3cfb5712fa937b, старый 0.1.82 удалён.", "check-portability: 20/20, exit 0, включая tarball:matches-source и tarball:version-bumped.", "Извлечённый пакет импортируется: версия 0.1.83, формы both/request/flat, обе формы на одном входе."]
resultSummary: "Пакет оркестратора 0.1.83 собран со швом внутри: tarball совпадает с исходниками, портируемость 20/20, извлечённый пакет работает и отдаёт обе формы активации."
role: BACKEND
scope: [plugins/orchestrator/package.json, plugins/cc-dsh-orchestrator-0.1.83.tgz]
---

Собери пакет оркестратора 0.1.83 из текущего дерева, чтобы его можно было передать на установку. Подними версию в plugins/orchestrator/package.json, собери tarball тем же способом, что и прежние, и докажи, что он совпадает с исходниками. Ничего не устанавливай и не коммить.
