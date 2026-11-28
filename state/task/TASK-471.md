---
id: TASK-471
kind: task
title: "Пересобрать пакет состояния и вернуть HEAD в зелёное"
status: done
revision: 5
createdAt: 2026-11-28T14:58:35.596Z
updatedAt: 2026-11-28T15:21:27.747Z
boardId: task-mx0jcbn0-24o27r
chore: true
choreReason: "После правки поверхности и ядра пакет состояния отстаёт от исходников, из-за чего make verify на HEAD красный и развёртывание получило бы ядро без снятия связи."
nonScope: ["Не перезапускать сервер и не запускать apply.", "Не менять код плагина: только версия, сборка, коммит."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["pack-plugin: project-state 0.1.23 → 0.1.24, tarball 39 265 B, sha256 e6a7c421…, прежний 0.1.23.tgz удалён.", "Коммит 9d58b85: package.json, новый tgz, удаление старого.", "make verify → exit 0: 20/20 portability, ключевая строка [PASS] tarball:matches-source, boundaries gate ok, documentation ok, identity-guard patched.", "kit-update --check --json: план — write-profile-files: cordis.patch.yml, install-plugins project-state 0.1.24 и state-feed 0.1.10, write-rules; server.running=true."]
resultSummary: "Пакет состояния пересобран (0.1.24) и закоммичен, HEAD зелёный: 20/20 переносимости с [PASS] tarball:matches-source; план kit-update содержит 0.1.24 и 0.1.10 и правку профиля."
role: DEVOPS
scope: [packages/, plugins/project-state/package.json]
---

Пересобери пакет состояния и верни HEAD в зелёное. Сейчас make verify красный на tarball:matches-source: README.md, lib/core.mjs, index.mjs и lib/views.mjs в плагине отличаются от cc-dsh-project-state-0.1.23.tgz. Сделай: (1) подними версию project-state до 0.1.24, собери пакет через pack-plugin и удали прежний tgz; (2) закоммить package.json и оба tgz; (3) прогони make verify и приложи код возврата и строку tarball:matches-source; (4) назови версии пакетов, которые теперь стоят в плане kit-update. Сервер не перезапускай, apply не запускай.
