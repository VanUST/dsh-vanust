---
id: TASK-343
kind: task
title: "`dsh web` делает всё сама: сведение, отказ от устаревшего запуска, явный перезапуск"
status: done
revision: 13
createdAt: 2026-11-27T12:52:52.062Z
updatedAt: 2026-11-27T14:07:54.896Z
acceptance:
  - text: "Одна команда `dsh web` без расхождения запускается быстро и не трогает профиль."
    done: false
  - text: "`dsh web` при расхождении и свободном порту сводит машину (--apply --no-harness --no-tools --keep-model-config) и только потом запускает харнесс."
    done: false
  - text: "`dsh web` при расхождении и живом сервере ОТКАЗЫВАЕТСЯ запускаться по устаревшему профилю: печатает причину, порт, pid и строку `dsh web --restart`, выходит 1."
    done: false
  - text: "`dsh web --restart` останавливает сервер по pid из измерения, ждёт освобождения порта, сводит и запускает."
    done: false
  - text: "При неудачном сведении обёртка печатает причину и выходит 1, называя DSH_KIT_BOOT=0; тихого запуска по старому профилю нет."
    done: false
  - text: "Установленная обёртка $DSH_HOME/bin/dsh совпадает с scripts/dsh-wrapper.sh после подстановки KIT_DIR, и каждое решение пишется в $DSH_HOME/kit-boot.log."
    done: false
boardId: task-mwyzesnm-epylhy
nonScope: ["Не применять сведение к живому дому /home/iustimov/.npm/dsh и не останавливать сервер :3080: проверка отказа идёт на живом сервере, проверка сведения — на временном DSH_HOME.", "Не менять логику обёртки по ходу проверки: найденный дефект описывается, а не правится."]
owner:
  kind: agent
  label: DOCS
preset: docs
reqIds: [REQ-271]
resultEvidence: ["Установка: sed подстановка KIT_DIR → $DSH_HOME/bin/dsh, INSTALLED-MATCHES (diff пуст); в установленной копии `--kit-restart|--restart) RESTART=1` (56), stop_running_server (131) до оценки состояния (172), KIT реальным путём (38).", "Реальный отказ на :3080: три строки с портом 3080 и строкой `dsh web --restart`, EXIT=1; в kit-boot.log `refused`; сервер не тронут.", "Реальное сведение временного дома: `dsh web --port 34999 --help` → `kit.applied … install-plugins … restart=required`, `converge ok`, затем exec реального харнесса (Usage: dsh --profile web), EXIT=0.", "Быстрый путь на сведённом доме: EXIT=0 за 7.7 с, `converge start` до и после = 1.", "`--restart` на реальном временном сервере: `restart requested: stopping server pids 2894484` → `restart: server stopped` → exec, EXIT=0, порт освобождён.", "Неудачное сведение на настоящем kit-update (DSH_HOME только для чтения): причина и `DSH_KIT_BOOT=0`, EXIT=1, exec не состоялся.", "Матрица веток на контролируемом стенде: clean 134 мс; drift+down — apply+exec; drift+up — отказ 1; `--restart` drift+up — stop/converge/exec 790 мс; `--restart` clean+up — stop без apply; apply fail — 1.", "sh -n чистый; флаг и три ветки описаны в rules/DEPLOYMENT.md §3 и docs/GUIDE.md §12."]
resultSummary: "`dsh web` теперь одна команда, которая делает всё сама: спрашивает у kit-update расхождение и живой сервер, запускается при чистой машине (7.7 с, без записи профиля), сводит при расхождении на свободном порту, отказывается запускать устаревший профиль при живом сервере и по `--restart` останавливает сервер по измеренному pid, ждёт порт, при необходимости сводит и запускает. Доказано на настоящем kit-update: сведение временного дома с нуля с установкой 0.1.78 и последующим запуском харнесса, быстрый путь, реальный отказ на :3080, реальная остановка временного сервера и неудачное сведение с кодом 1."
role: DOCS
scope: [scripts/dsh-wrapper.sh, scripts/install.sh, rules/DEPLOYMENT.md, docs/GUIDE.md, /home/iustimov/.npm/dsh/bin/dsh]
---

Сделать `dsh web` единственной командой, которая делает всё сама: спрашивает у kit-update состояние (расхождение + живой сервер), сводит машину когда это безопасно, отказывается запускаться по устаревшему профилю и по флагу --restart останавливает сервер, сводит и запускает. Код обёртки переписан; установить копию и доказать три пути прогонами.
