---
id: TASK-445
kind: task
title: "Прогонять тест проверки документации штатным гейтом"
status: done
revision: 5
createdAt: 2026-11-28T13:24:06.221Z
updatedAt: 2026-11-28T13:41:14.526Z
boardId: task-mx0fyt6q-q5faau
chore: true
choreReason: "Найдено при проверке документации: тест правила лежит там, куда make test не смотрит, поэтому правило может сломаться незаметно."
nonScope: ["Не менять сами правила проверки; только место теста или обход в test-all."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 71701a84-994b-4687-971c-460d12b2cd09
preset: backend
resultEvidence: ["git mv scripts/check-documentation.test.mjs scripts/test/check-documentation.test.mjs, внутри одна константа пути.", "node --test scripts/test/check-documentation.test.mjs → 9/9, exit 0; test-all --list → 87 of 87, шаг scripts\\test\\check-documentation.test.mjs присутствует.", "make test: шаг 65 «ok scripts\\test\\check-documentation.test.mjs», остановка позже на чужом красном delegation-basis-proof (TASK-446).", "Остальные 15 шагов после остановки прогнаны по одному: exit 0."]
resultSummary: "Тест правила документации перенесён в scripts/test и теперь выбирается штатным гейтом (87 шагов вместо 86); сам тест зелёный."
role: BACKEND
scope: [scripts/test-all.mjs, scripts/check-documentation.test.mjs, scripts/test/]
sessions:
  - sessionId: 71701a84-994b-4687-971c-460d12b2cd09
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Сделай так, чтобы тест проверки документации действительно прогонялся штатным гейтом. Замер: scripts/check-documentation.test.mjs существует и проходит вручную (9/9), но node scripts/test-all.mjs его не видит — обход в scripts/test-all.mjs смотрит только scripts/test/ и scripts/*-proof.mjs. Это ложноположительное состояние: правило закреплено тестом, который никто не запускает. Нужно: либо перенести тест в scripts/test/ (и поправить пути импорта), либо расширить обход в test-all.mjs на scripts/*.test.mjs — выбери меньшую правку и объясни выбор. Докажи: make test включает этот тест и он зелёный; полный прогон не сломан.
