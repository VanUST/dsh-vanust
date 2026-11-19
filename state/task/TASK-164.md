---
id: TASK-164
kind: task
title: "Повтор запроса после MALFORMED_RESPONSE: ход не должен падать"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.288Z
updatedAt: 2026-11-17T15:52:41.288Z
acceptance:
  - text: "Строка линтуется и композиция принимается: --dump-config показывает retryPolicy с MALFORMED_RESPONSE на маршруте"
    done: false
  - text: "Красный прогон без правки: фейковый провайдер отдаёт битый JSON один раз — прогон завершается кодом 1 с MALFORMED_RESPONSE, один запрос к провайдеру"
    done: false
  - text: "Зелёный прогон с точной строкой из файла kit-а: тот же фейковый провайдер — прогон завершается кодом 0, два запроса, в журнале сессии llm/retry и llm/retry-started"
    done: false
  - text: "make verify проходит; в профиле не появилось других изменений"
    done: false
boardId: task-mwkh6334-358zg6
inline: true
nonScope: ["исходники харнесса (@deepseek-ai/*) — не форкаем и не патчим установленный пакет", "перезапуск живого сервера :3080 и правка $DSH_HOME/profiles/web/cordis.patch.yml при работающем сервере", "маршруты вне этого развёртывания и изменение умолчаний харнесса", "коды STREAM_CLOSED и прочие — отдельное решение, только назвать в отчёте"]
resultArtifacts: [profile/cordis.patch.yml, rules/DEPLOYMENT.md, docs/TERMINOLOGY.md, docs/cases/malformed-response.json, /tmp/dsh-retry-proof/EVIDENCE.txt]
resultEvidence: ["Красный прогон (политика по умолчанию, фейковый Messages-сервер отдаёт один tool_use с незакрытым JSON): `dsh --profile headless 'Say proof-answer.'` → exit 1, stderr `dsh: MALFORMED_RESPONSE: DeepSeek Messages stream: tool input is invalid JSON`; в журнале сессии `turn/end` с `reason.kind: error`, `llm/retry` 0; провайдер увидел один агентский запрос.", "Зелёный прогон (та же задача + `--patch` с байт-в-байт выделенной строкой из profile/cordis.patch.yml): exit 0, stdout `proof-answer`; провайдер увидел два агентских запроса (шаги 1 и 2, второй через 0.55 с); в журнале `llm/retry` с `provider deepseek-official`, `retry 1`, `delayMs 462`, `failure.code MALFORMED_RESPONSE` и `llm/retry-started`.", "Композиция: `--dump-config` на полном kit-профиле (`DSH_HOME=/tmp/proof-home`) — exit 0, оба блока `retryPolicy` (строки 467 и 117 дампа) с шестью кодами; строка `llm-deepseek` помечена `patched by .../cordis.patch.yml`.", "`make verify` — exit 0: 17/17 portability and packaging checks passed + documentation ok.", "Артефакты: /tmp/dsh-retry-proof/{EVIDENCE.txt,row.yml,red.out,red.err,green.out,green.err,requests.jsonl,kitdump.yml}."]
resultSummary: "Политика повтора включена на оба маршрута развёртывания: `retryPolicy` (normal, 5 попыток на шаг) теперь перечисляет `MALFORMED_RESPONSE` рядом с пятью умолчаниями харнесса. Правка в `profile/cordis.patch.yml` (строки `llm-deepseek` и `kimi-coding`), операторская строка в `rules/DEPLOYMENT.md`, термины в `docs/TERMINOLOGY.md`, требование владельца — intake-кейс `malformed-response` (unverified). Коммит 4c05ee6. Живой сервер :3080 не трогал: политика применится при следующем запуске, обёртка сойдётся на kit-е."
scope: ["profile/cordis.patch.yml — политика повтора на маршрутах llm-deepseek и kimi-coding", "rules/DEPLOYMENT.md — строка про политику повтора в таблице маршрутов/плагинов", "docs/TERMINOLOGY.md — термин «повтор запроса», если он нужен надолго", "доказательства в /tmp вне репозитория (фейковый Messages-сервер, логи прогонов)"]
---

Ответ модели с невалидным JSON аргументов инструмента (`MALFORMED_RESPONSE`, сообщение `tool input is invalid JSON`) сейчас завершает ход: политика повтора маршрута DeepSeek по умолчанию перечисляет только EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT и TRANSPORT. Владелец просит, чтобы агент не останавливался из-за такого ответа. Изменить политику повтора маршрута в патче профиля kit-а, доказав красным и зелёным прогоном на фейковом провайдере, что ход переживает такой ответ.

Migrated from .dsh/taskboard.json (task task-mwkh6334-358zg6, revision 4).
