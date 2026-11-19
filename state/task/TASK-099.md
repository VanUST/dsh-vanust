---
id: TASK-099
kind: task
title: "Аналитика экспорта usage_data_2026-10-14_2026-11-12"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.239Z
updatedAt: 2026-11-17T15:52:40.239Z
acceptance:
  - text: "итоговые суммы сходятся с cost CSV (USD + CNY-грант)"
    done: false
  - text: "расход 12.11 по каждому ключу совпадает с дашбордом в пределах округления"
    done: false
  - text: "объяснение app-managed опирается на поля архива (пустой api_key)"
    done: false
boardId: task-mwdjog8v-1ng8zy
inline: true
nonScope: ["не менять ключи/аккаунт и настройки платформы", "не отправлять данные наружу", "не трогать $DSH_HOME/.credentials.yaml"]
resultEvidence: ["unzip -o -q ~/Downloads/usage_data_2026-10-14_2026-11-12.zip → cost-2026-10-14_2026-11-12.csv, amount-2026-10-14_2026-11-12.csv", "cost CSV total USD = 166.61732844300002; плюс 6.03206928 CNY гранта на 2026-10-22", "per-key: vanyek sk-0271 $103.41 (48435 req), Vanyek sk-50ffa $35.36, Nazar $22.00, DeepSeek Harness (App-managed) $5.72 (2182 req, api_key пусто), Vladislove $0.74, Tagar $0.29", "12.11 сверка с дашбордом: harness 2.38 vs 2.37, Nazar 0.33 vs 0.32 — совпадает; vanyek 3.80 vs 3.38 — экспорт полнее снимка", "/home/iustimov/dsh-kit/.usage-analysis/usage-2026-10-22_11-12.png — график по дням и ключам"]
resultSummary: "Архив разобран и сверен. Расход 22.10–12.11 = $167.5 (166.62 USD + 6.03 CNY грант), 19 активных дней, среднее $8.8/день. Строка «DeepSeek Harness (App-managed)» — $5.72 (3.4%), 2 182 запроса, 9 дней, поле api_key пустое (значит не ключ консоли, а учётная запись приложения): 99% контекста из кэша, 333K токенов на запрос, $0.0026/запрос. Основной расход — собственный ключ sk-0271…c44b этой машины: $103.41 (61.7%), 48 435 запросов, 257K контекста на запрос; старая его же ключ-версия sk-50ffa…f3eb дала $35.36 (ротация 30.10). Nazar $22.00. Драйвер трат — объём контекста и число запросов, не «дорогой» app-managed ключ: у app-managed выше только доля пикового тарифа (34% output по x2 против 4–6% у личных ключей)."
scope: ["~/Downloads/usage_data_2026-10-14_2026-11-12.zip (только чтение)", "/home/iustimov/dsh-kit/.usage-analysis/ (распаковка, скрипты, график)"]
---

Разобрать скачанный с платформы DeepSeek архив usage_data_2026-10-14_2026-11-12.zip (cost/amount CSV), восстановить расход по API-ключам и дням, объяснить строку «DeepSeek Harness (App-managed)», сверить с дашбордом пользователя и дать рекомендации.

Migrated from .dsh/taskboard.json (task task-mwdjog8v-1ng8zy, revision 4).
