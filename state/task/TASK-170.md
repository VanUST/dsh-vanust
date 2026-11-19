---
id: TASK-170
kind: task
title: "Удалить Headroom с машины и принять результат правок кита"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.395Z
updatedAt: 2026-11-17T15:52:41.395Z
boardId: task-mwkigacm-vn1v7g
inline: true
nonScope: ["правки файлов репозитория (их делает BACKEND)", "перезапуск живого dsh web на :3080", "удаление истории из docs/cases"]
resultEvidence: ["systemctl --user disable --now headroom.service → «Removed /home/iustimov/.config/systemd/user/default.target.wants/headroom.service»; is-active → inactive; файл юнита удалён, daemon-reload выполнен; юнит был Restart=always, WantedBy=default.target — без disable он бы воскресил посредника", "curl http://127.0.0.1:8787/readyz → 000; процессы headroom не найдены", "rm -rf /home/iustimov/.npm/dsh/headroom после realpath-проверки (enabled, patch.yml, proxy.log 10 816 687 Б); uv tool uninstall headroom-ai → «Uninstalled 2 executables: headroom, headroom-cache-ttl»; uv tool list и ~/.local/bin без headroom", "Приёмка правок репозитория: node scripts/rtk-selftest.mjs → PASS, 6 shrank / 3 passed / 0 failed; node scripts/check-documentation.mjs → documentation ok; check-portability 16/17, единственный красный — tarball:matches-source по чужому designmap (mtime его исходников 2026-11-17 12:49 и 12:55 против последнего коммита 2026-11-16 17:17)", "tar -xzOf plugins/cc-dsh-rtk-0.1.7.tgz package/rtk.mjs | diff - plugins/rtk/rtk.mjs → пусто; то же для orchestrator 0.1.47"]
resultSummary: "Посредник Headroom снят с машины полностью: systemd-юнит был отключён, удалён и daemon-reload выполнен (иначе Restart=always воскресил бы процесс), порт 8787 закрыт, каталог $DSH_HOME/headroom с маркером и журналом на 10,8 МБ удалён, инструмент uv удалён (две программы). Затем приняты правки кита от специалиста: проверены тексты раздела RTK и политики специалиста, перепакованы тарболы после замечаний ревью (rtk 0.1.7, orchestrator 0.1.47), гейты check-documentation и rtk-selftest зелёные; единственный красный check-portability — чужой designmap, правки которого идут параллельно в том же дереве."
scope: ["состояние машины: процессы headroom, ~/.npm/dsh/headroom, uv tool"]
---

Убрать Headroom с машины (остановить посредник, удалить маркер и каталог $DSH_HOME/headroom, удалить установленный инструмент) и после правок специалиста BACKEND самостоятельно подтвердить весь результат: гейты кита, отсутствие висячих ссылок, тексты раздела RTK и политики специалиста, репак тарболов, чистота git-диффа.

Migrated from .dsh/taskboard.json (task task-mwkigacm-vn1v7g, revision 5).
