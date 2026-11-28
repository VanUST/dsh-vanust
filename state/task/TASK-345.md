---
id: TASK-345
kind: task
title: "Сервер, запущенный без `--port`, должен попадать в pid своего порта"
status: done
revision: 7
createdAt: 2026-11-27T13:05:45.229Z
updatedAt: 2026-11-27T14:02:06.018Z
acceptance:
  - text: "`node scripts/kit-update.mjs --check --port 3080 --json` называет pid живого сервера :3080 (сейчас он запущен без `--port` и в `server.pids` не попадает)."
    done: false
  - text: "Сервер, запущенный без `--port` на непустом порту, попадает в pid именно этого порта, а не 3080 (тест с синтетическим процессом, слушающим свой порт)."
    done: false
  - text: "Процесс без `--port`, который ничего не слушает, ни в один pid-список не попадает."
    done: false
  - text: "Предки самого проверяющего процесса по-прежнему исключены."
    done: false
  - text: "Тест красный до правки и зелёный после; make verify зелёный; форма JSON не изменилась."
    done: false
  - text: "`dsh web --restart` на машине, где сервер запущен без `--port`, находит pid и останавливает его (доказательство: `server.pids` непустой для его порта; сам TERM по живому :3080 не выполнять)."
    done: false
boardId: task-mwyzvd59-o90csy
nonScope: ["Не менять scripts/dsh-wrapper.sh.", "Не трогать живой дом и сервер :3080 (никаких kill, никакого --apply).", "Не менять docs/ и rules/."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-272]
resultEvidence: ["Красный: ✖ a dsh web started without --port is attributed to the port it listens on (AC-1) — \"a dsh web without --port must be named for the port it listens on: []\", exit 1.", "Зелёный: 7 тестов, 0 падений — портлесс-листенер назван своим портом, молчащий портлесс нигде, предки исключены, гейт харнесса держит оба направления, exit 0.", "Живая машина, проверка из не-потомка (двойной fork): server {\"port\":3080,\"running\":true,\"http\":{\"running\":true,\"detail\":\"HTTP 401\"},\"pids\":[6272]}; ps -o pid= -p 6272 → 6272 (сервер цел, TERM не посылался).", "Привязка: 6272/fd/27 → socket:[103681]; /proc/net/tcp: 0100007F:0C08 … 0A … 103681 (= 3080, listening).", "make verify exit 0; make test ONLY=scripts/test 2/2; ключи JSON не изменились.", "Кейс dsh-web-without-port-is-named-for-the-port-it-listens-on: case_run красный (exit 1) → зелёный (exit 0)."]
resultSummary: "Сервер, запущенный без `--port`, теперь атрибутируется порту, который фактически слушает (таблица слушающих сокетов + дескрипторы процесса, лениво и только для таких процессов). Проверка из не-потомка на живой машине даёт `pids:[6272]` для 3080 — значит `dsh web --restart` найдёт кого останавливать. Процесс без порта и без сокета остаётся только машинным сигналом и ни в один pid-список не попадает."
role: BACKEND
scope: [scripts/kit-update.mjs, scripts/test/kit-update-server-scope.test.mjs]
---

Изменение привязало pid к объявленному `--port`, но живой сервер запущен как `dsh web` без `--port`, и теперь `server.pids` для его порта пуст: `dsh web --restart` не может его остановить (падает по таймауту вместо остановки). Атрибутируйте процесс без `--port` к порту, который он ФАКТИЧЕСКИ слушает (сокет в /proc/net/tcp + дескрипторы процесса), а не к догадке 3080: сервер на 4000 без флага не должен попасть в pid 3080. Докажите красным-до/зелёным-после.
