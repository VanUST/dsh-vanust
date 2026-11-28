---
id: TASK-509
kind: task
title: "Профиль и карта ролей: расхождение должно валить гейт"
status: done
revision: 4
createdAt: 2026-11-28T18:15:42.839Z
updatedAt: 2026-11-28T18:27:48.524Z
boardId: task-mx0qdtp1-jt37ot
chore: true
choreReason: "Найдено расхождение: политика плагина кейсов отдаёт роли BACKEND case_update и case_verify, а профиль — нет; проверка ролей сверяет README с картой плагина и профиль не видит, поэтому дрейф невидим."
nonScope: ["Не менять политику плагина кейсов и код инструментов.", "Не перезапускать сервер."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 03bf75aa-207a-4b54-8bae-a12a0ca51e90
preset: backend
resultEvidence: ["check-role-table теперь читает families.<preset>.allow из профиля и сверяет с DEFAULT_ROLE_TOOLS в обе стороны; на профиле «до правки» красный: «profile row backend — profile is missing case_update, case_verify, case_suite», exit 1; после правки role table ok, exit 0.", "Возвращены обещанные картой глаголы: orchestrator — case_gate, backend — case_suite/case_update/case_verify, reviewer — case_verify, research — case_get/case_list.", "Тест scripts/test/check-role-table.test.mjs 3/3; негативный контроль CASE_NEGATIVE_CONTROL=expect-no-profile-check падает на утверждении «старая проверка пропускает дрейф» — значит тест умеет краснеть.", "make verify exit 0; tool-surface-proof PASS (6 проверок), context-bounds-proof PASS (29); scripts/test 45 тестов, 38 pass, 0 fail, 7 skipped."]
resultSummary: "Расхождение профиля и карты ролей закрыто и теперь ловится гейтом: возвращены шесть обещанных глаголов у четырёх ролей, проверка ролей сверяет профиль с картой в обе стороны и краснеет на дрейфе."
role: BACKEND
scope: [profile/cordis.patch.yml, scripts/check-role-table.mjs, scripts/test/]
sessions:
  - sessionId: 03bf75aa-207a-4b54-8bae-a12a0ca51e90
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Устрани расхождение между картой ролей плагина и профилем, из-за которого кейс нельзя перепривязать. Сейчас plugins/test-cases обещает роли backend инструменты case_update и case_verify, а в profile/cordis.patch.yml у backend только case_get, case_list, case_record, case_run; scripts/check-role-table.mjs сверяет README с картой плагина и профиль не проверяет, поэтому дрейф проходит гейт. Сделай: (1) добавь backend недостающие глаголы в профиль; (2) научи check-role-table сверять и allow-список профиля с картой ролей плагина, чтобы такое расхождение валило гейт; (3) тест: на нынешнем (до правки) профиле проверка красная с названием роли и глагола, после правки зелёная; (4) прогони проверку ролей и приложи коды. Верни: что изменилось, коды, что осталось.
