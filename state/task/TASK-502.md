---
id: TASK-502
kind: task
title: "Ворота консультации: по флагу, а не по классу"
status: done
revision: 6
createdAt: 2026-11-28T18:08:00.049Z
updatedAt: 2026-11-28T18:11:18.872Z
boardId: task-mx0q3wee-jbpzdv
chore: true
choreReason: "Критик нашёл ложный зелёный: ворота консультации срабатывают только при классе L2, поэтому флаг impact без класса проходит мимо."
nonScope: ["Не менять формат записи решения и текст отказа по существу.", "Не требовать консультации для L0/L1 без флага."]
owner:
  kind: agent
  label: BACKEND
  sessionId: e4e13ac1-8225-4dfa-b344-857844b44af7
preset: backend
resultEvidence: ["Условие: analysisGate.analysisRequired === true && args.architectureImpact === true (без проверки класса) — orchestrator.mjs:1177.", "Прогон продукта: L2+флаг → architect_consult_required, 0 задач и 0 детей; флаг без changeClass → тот же отказ; L2 без флага → проходит; L1 без флага → проходит.", "Тест «the flag decides, not the class»: на прежнем условии exit 1 («a flagged delegation without changeClass was not refused»), после правки 8/8; набор orchestrator 57/57 exit 0.", "Кейс the-architecture-consultation-gate-fires-on-architectureimpa: красный control expect-pre-fix exit 1, зелёный exit 0, status verified."]
resultSummary: "Ворота консультации срабатывают по флагу architectureImpact независимо от класса: флаг без changeClass больше не проскакивает; L2 без флага и L1 без флага идут как раньше; текст отказа больше не утверждает класс."
role: BACKEND
scope: [plugins/orchestrator/orchestrator.mjs, plugins/orchestrator/test/]
sessions:
  - sessionId: e4e13ac1-8225-4dfa-b344-857844b44af7
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Закрой ложный зелёный в воротах архитектурной консультации. Сейчас консультация запускается только когда производный класс равен L2 (orchestrator.mjs, проверка после ворот анализа), поэтому делегирование с architectureImpact:true и без указанного changeClass получает класс L1 и проходит мимо ворот; равным образом L2 без флага не проверяется вовсе. Сделай: (1) ворота срабатывают по флагу architectureImpact === true независимо от класса; (2) сохрани поведение L0/L1 без флага; (3) тест: три случая из находки критика — L2+флаг отказ, флаг без класса отказ, L2 без флага проходит; плюс проход с записанным ARCH- решением; (4) прогони набор orchestrator и приложи коды. Верни: что изменилось в условии, коды и что осталось.
