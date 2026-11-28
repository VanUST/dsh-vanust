---
id: TASK-294
kind: task
title: "P1 pilot: живой TESTER на временном профиле с ключом харнесса"
status: done
revision: 4
createdAt: 2026-11-22T19:46:12.383Z
updatedAt: 2026-11-22T20:10:50.118Z
acceptance:
  - text: "Ключ найден/использован без печати; temp-профиль видит credential и стартует живую сессию"
    done: false
  - text: "2–3 задачи проведены; case JSON/run.json/taskboard/транскрипт приложены; WRITE_SCOPE и wrong-product red показаны"
    done: false
  - text: "Shell/S4/B2/B3 названы границей; realism проверен человеком/независимым ролью"
    done: false
  - text: "live :3080 и profiles/web не тронуты; исходники/docs/cases не изменены; сервер остановлен"
    done: false
  - text: "Если блокер — точный (credential/entry point/bundle), без имитации и без ключа в отчёте"
    done: false
boardId: task-mws8z37y-r56l8q
nonScope: ["live profile ~/.npm/dsh/profiles/web и :3080; их переустановка/остановка", "исходники C:/dsh-kit, docs/cases, существующие задачи", "P2 task contract (уже идёт отдельным BACKEND), P1 код, журнал/подпись", "не печатать/не коммитить API-ключ"]
owner:
  kind: agent
  label: PILOT
  sessionId: e1b9b5fe-491b-4767-8715-993f4c0d693b
preset: backend
reqIds: [REQ-191]
resultArtifacts: ["%TEMP%\\p1-pilot\\PILOT-REPORT.md", "%TEMP%\\p1-pilot\\evidence\\taskboard.json", "%TEMP%\\p1-pilot\\evidence\\case.json", "%TEMP%\\p1-pilot\\evidence\\runs", "%TEMP%\\p1-pilot\\evidence\\gui.png"]
resultEvidence: ["key probe: without env -> MISSING_CREDENTIAL exit 1; with DEEPSEEK_API_KEY from store -> PILOT_OK exit 0, api.deepseek.com models loaded 2", "server 3081 HTTP 200 with token, 401 without; after stop down; temp profile copy, live hashes unchanged (cordis.patch.yml C983AB70..., .credentials.yaml 36188ED7...)", "red: run mws9ofml-e7bvv-1, exit 1, passed false, stderr sum(1,2,3)=5 expected 6, redSource wrong-product; fix 7841704; green run mws9pfgh-f7k4h-1, exit 0, sum ok; case verified rev 6, runs 2", "WRITE_SCOPE on sum.mjs via edit (sha unchanged); shell Add-Content writes sum.mjs exit 0 (named boundary); S4 case_update status ignored ok:true", "8 tasks 7 done 1 cancelled; artifacts %TEMP%\\p1-pilot\\PILOT-REPORT.md, taskboard.json, case.json, runs, state-events.jsonl, transcripts zstd, gui.png; sk- scan empty"]
resultSummary: "Живой пилот P1 проведён. Временный web-профиль (копия live + kit-тарболы) на 3081, ключ из C:\\Users\\1\\.dsh\\.credentials.yaml только как env, в отчёт/артефакты не попал (скан sk- пуст). 8 задач taskboard: 7 done, 1 cancelled. TESTER написал кейс приёмки с failsWhen/trigger/oracle/realism, снял wrong-product red на внешней копии предыдущего коммита (exit 1, sum(1,2,3)=5 expected 6), BACKEND починил (7841704), TESTER снял зелёный (exit 0, sum ok), case verified. WRITE_SCOPE на edit продукта показан; shell-запись продукта прошла и названа границей; S4 через case_update status молча проигнорирован (ok:true, статус не изменён) — находка, не имитация. Live :3080 и profiles/web не тронуты (хеши до/после), сервер и Chrome остановлены. P1 FR7 deferred с evidence; формальный TEST не создан."
role: PILOT
scope: ["live home ~/.npm/dsh: чтение credential store/config; новый временный профиль внутри live home или полная копия home в %TEMP%; profiles/web не изменять", "temp workspace в %TEMP% с git, продуктом и дефектом", "DSH на 3081/3082, managed background job; URL/токен; headless или web-клиент", "артефакты в %TEMP%: транскрипт, taskboard, case JSON, run.json; ключ не в отчёте"]
sessions:
  - sessionId: e1b9b5fe-491b-4767-8715-993f4c0d693b
    label: PILOT
    role: PILOT
    status: sleeping
---

Провести живой пилот P1 с ключом провайдера из текущего харнесса. Владелец сказал: «можешь взять апи ключ из текущего харнесса — он должен быть записан». Найди записанный ключ/credential в live-профиле или credential store, не печатай его и не пересылай в отчёте. Собери временный профиль, который видит этот credential (например, новый профиль внутри live home или полная копия home с credential store; profiles/web и :3080 не менять), установи P1-тарболы (test-cases 0.1.32, proof-guard 0.1.4, orchestrator 0.1.65, taskboard 0.1.74), подними сервер на 3081/3082 и проведи 2–3 живые задачи: TESTER пишет кейс приёмки с failsWhen/trigger/oracle/realism, BACKEND правит, TESTER снимает wrong-product red и зелёный, гейт/закрытие. Отдельно WRITE_SCOPE, shell-граница, S4 как названная граница B1 и человеческая проверка realism. Собери транскрипт/taskboard/case JSON/run.json. Если headless-бандл не активирует kit-пэтч, попробуй web-профиль/headless или web-сервер + клиент; если не выходит — точный блокер. Не менять исходники C:/dsh-kit, docs/cases, profiles/web, :3080.
