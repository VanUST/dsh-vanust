---
id: TASK-344
kind: task
title: "Сигнал «сервер жив» привязать к порту профиля, замена харнесса остаётся машинной"
status: done
revision: 6
createdAt: 2026-11-27T12:57:06.496Z
updatedAt: 2026-11-27T13:10:25.114Z
acceptance:
  - text: "Тест `scripts/test/kit-update-server-scope.test.mjs` написан первым и КРАСНЫЙ на текущем коде: процесс `node .../bin.js web --port 34177` виден проверке `--check --port 3080` (цитата падения)."
    done: false
  - text: "После правки тот же тест зелёный: процесс чужого порта невидим для `--port 3080` и виден для `--port 34177` (цитата)."
    done: false
  - text: "Собственный процесс проверки и его предки исключены (тест на это)."
    done: false
  - text: "Гейт замены харнесса по-прежнему видит любой `dsh web` на машине: процесс в чужом доме на другом порту блокирует замену (тест, а не рассуждение)."
    done: false
  - text: "`make verify` и `node --test scripts/test/kit-update-server-scope.test.mjs` зелёные; `make test` зелёный или названное подмножество с причиной."
    done: false
  - text: "JSON-контракт `--check --json` не изменился по форме: ключи `drift`, `plan`, `server.port/running/http/pids` на месте (цитата вывода)."
    done: false
boardId: task-mwyzk5oi-f5z026
nonScope: ["Не менять scripts/dsh-wrapper.sh: обёртку правит оркестратор.", "Не менять docs/ и rules/: тексты обновляются отдельно.", "Не менять профиль, state/, docs/cases/, docs/analysis/."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-272]
resultEvidence: ["Красный: ✖ a dsh web on another port does not make this profile port look busy (AC-1) — \"a dsh web --port 35079 (pid …) made port 43829 look busy\", и ✖ the check own process and its ancestors are never named (AC-3) — \"the check own parent … was offered for TERM: [2818819,2819411,2819412,6272]\"; exit 1.", "Зелёный: 5/5 (чужой порт не занимает профильный, предки исключены, гейт замены харнесса видит любой dsh web, контрольная ветка без серверов), exit 0.", "Продуктовый прогон с синтетическим `dsh web --port 34177`: --check --port 34177 → running:true pids:[2827630]; --check --port 34178 → running:false pids:[]; --check --port 3080 → running:true по HTTP 401.", "make verify exit 0; make test ONLY=scripts/test → 2/2 passed, exit 0.", "Кейс dsh-web-on-another-port-is-not-this-port-server: case_run красный (exitCode 1) → зелёный (exitCode 0, verified)."]
resultSummary: "`--check --json` отвечает на два вопроса раздельно из одного прохода по /proc: `server.running`/`server.pids` — только сервер запрошенного порта (процесс с этим `--port` или HTTP-ответ на нём), а гейт замены харнесса читает машинный список и по-прежнему отказывает при любом `dsh web`. Собственный процесс проверки и его предки исключены из pid-списка. Тест написан первым и был красным на старом коде, зелёный после."
role: BACKEND
scope: [scripts/kit-update.mjs, scripts/test/kit-update-server-scope.test.mjs]
---

`kit-update --check --json` отвечает на два разных вопроса одним флагом: `server.running` истинно, если на машине есть ЛЮБОЙ процесс `dsh web`, независимо от `--port` и дома. Из-за этого: (1) ветка обёртки «расхождение + свободный порт» недостижима, пока жив хоть один сервер; (2) `dsh web --restart` может послать TERM процессам, которые не являются сервером этого порта (в отчёте исполнителя в списке оказались собственные процессы проверки). Разделите два сигнала из одного прохода по /proc: порт-специфичный — для решения «сводить ли этот профиль» и для pid, по которым можно бить TERM; машинный — для гейта замены харнесса (он должен остаться консервативным). Докажите красным-до/зелёным-после тестом.
