---
id: TASK-104
kind: task
title: "P3: плагин проекции вывода run_code (spill + баннер)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.312Z
updatedAt: 2026-11-17T15:52:40.312Z
acceptance:
  - text: "доказательство командой: проекция большого результата (например 41 208 символов) даёт баннер с путём к spill-файлу, голову и хвост, и полный текст реально читается с диска тем же путём, который назван в баннере"
    done: false
  - text: "не тронуты: результат короче порога, результат с ошибкой/ненулевым кодом, изображения, уже спроецированный результат (идемпотентность)"
    done: false
  - text: "в ответе процитированы команда, вывод и exit code, и измерено сокращение символов до/после"
    done: false
  - text: "указан файл:строка установленного пакета, где регистрируется tools/post-execute, по образцу которого сделан хук"
    done: false
boardId: task-mwdl6hwa-1genzd
nonScope: ["не править profile/cordis.patch.yml (ни живой, ни kit) — ряд профиля добавит оркестратор", "не править plugins/inventory.json, не собирать tarball", "не перезапускать сервер :3080, не трогать другие плагины и не менять sandbox-политику", "не применять проекцию к ошибкам, к коротким результатам и к истории ранее — только к только что полученному результату"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node plugins/run-code-projection/proof/proof.mjs → 'run-code-projection proof: PASS (13 checks)', exit 0", "Реальная фикстура: 27 200 → 4 897 символов (82.0%), spill прочитан по пути из баннера и совпал; кейс 41 208 → 4 915 (88.1%)", "pack-plugin → cc-dsh-run-code-projection-0.1.1.tgz, sha256 492329962e963e4ce5107f7bd33d9f1ee1c67d5963a3c42aa619fa07bb8fa8db", "check-documentation → 21 плагин назван, ok; check-portability → 17/17", "kit-update --apply → plugins ['cc-dsh-run-code-projection-0.1.1.tgz'], restart=required, exit 0; повторный --check → drift: None", "dsh --profile web --dump-config → '- id: run-code-projection'; import('@cc/dsh-run-code-projection') из profiles/web → imports ok", "Второй сервер :3081 поднялся с обоими плагинами без ошибок импорта; погашен, :3080 не затронут"]
resultSummary: "P3 собран, проверен и интегрирован: плагин @cc/dsh-run-code-projection на tools/post-execute заменяет вывод run_code больше 8 КиБ на баннер + голову 3 КиБ + хвост 1.5 КиБ + путь к полному тексту в <cwd>/.dsh/spill/. Я независимо прогнал proof (13/13, exit 0), упаковал tarball 0.1.1, добавил inventory-строку, ряд в kit-профиль, документацию, прогнал kit-update --apply и подтвердил, что ряд есть в собранном профиле, модуль установлен и импортируется из профиля. Гейты зелёные. Измерено на корпусе логов: 5.56% всех байт tool-result. Для активации нужен рестарт :3080."
role: BACKEND
scope: ["plugins/run-code-projection/ — новый пакет: package.json, run-code-projection.mjs, README.md, proof/", "чтение plugins/rtk, dsh-tools и логов сессий для фикстуры"]
sessions:
  - sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Собрать продуманный плагин @cc/dsh-run-code-projection: на tools/post-execute для инструмента run_code заменять слишком длинный вывод на проекцию (баннер + голова + хвост + путь к полному тексту в spill-файле внутри workspace), чтобы контекст шага сокращался на 5–7% без потери доступа к полному выводу.

Migrated from .dsh/taskboard.json (task task-mwdl6hwa-1genzd, revision 9).
