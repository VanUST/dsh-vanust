---
id: TASK-416
kind: task
title: "Ревью префиксного кэширования и сжатия контекста"
status: done
revision: 8
createdAt: 2026-11-28T10:45:35.344Z
updatedAt: 2026-11-28T10:52:44.919Z
acceptance:
  - text: "Раздельно описать state, ленивую подгрузку, схемы/порядок инструментов, обрезку результатов и сжатие; привязать к установленной версии и файлам, указать ограничения измерения."
    done: false
boardId: task-mx0aaygn-mqkmt5
chore: true
choreReason: "Ревью существующего контекста без реализации."
nonScope: ["Не менять код и файлы проекта, маршруты, настройки и развёртывание; не отправлять дополнительные запросы к моделям."]
owner:
  kind: agent
  label: CONTEXT
  sessionId: 03deb0b4-e64c-4abe-aa40-4e3215024ef6
preset: gatherer
resultEvidence: ["Установленные пакеты: dsh-agent-loop/src/agent.ts:293–312,448–496,672–748; dsh-agent-loop/src/runtime-context.ts:99–121; dsh-llm/src/content.ts:425–508; dsh-llm-deepseek/src/models.ts:8–22, src/translate.ts:34–42; dsh-llm-pi-ai/src/models.ts:70–91.", "plugins/state-feed/index.mjs:66–149 и lib/feed.mjs:20–56,198–232; отметки доставки хранятся в памяти плагина, а не извлекаются из истории.", "plugins/tool-families/tool-families.mjs:578–601,618–630,717–732; plugins/run-code-projection/run-code-projection.mjs:283–341; plugins/tail-pruner/tail-pruner.mjs:221–265,294–311; profile/cordis.patch.yml:50–69,1290–1326.", "В этой сессии наблюдалось сокращение нового результата с указанием пути к полному тексту. Запрос к провайдеру и статистику попаданий в кэш не снимали."]
resultSummary: "Отдельно установлено, когда меняются разделы промпта, схемы инструментов, сообщения о состоянии, новые результаты и старые сообщения при сжатии. Выводы по сборке относятся к установленному харнессу 0.2.2-rc.3; попадания в кэш и расход токенов не измерялись."
role: CONTEXT
sessions:
  - sessionId: 03deb0b4-e64c-4abe-aa40-4e3215024ef6
    label: CONTEXT
    role: CONTEXT
    status: sleeping
---

Установить реальный порядок сборки запроса и что меняют плагины, состав инструментов и сжатие контекста.
