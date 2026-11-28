---
id: TASK-496
kind: task
title: "Предел раздела архитектуры: 12 288 байт"
status: done
revision: 5
createdAt: 2026-11-28T17:47:55.436Z
updatedAt: 2026-11-28T17:50:57.580Z
boardId: task-mx0pe2s8-bjihrw
chore: true
choreReason: "Файл архитектуры вырос до 10 207 Б, а предел раздела в фиде 8 192 — архитектура приходит усечённой, то есть оркестратор видит не всю картину."
nonScope: ["Не менять сам архитектурный файл.", "Не трогать план и снимок."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["ARCHITECTURE_LIMIT_BYTES = 12288 в plugins/state-feed/lib/feed.mjs; первое сообщение 16 038 → 18 077 Б, маркера нет, последняя строка файла на месте.", "Прогон продукта через apply: {firstMessageBytes:18077, hasArchitectureSection:true, marker:false, lastLineOfPagePresent:true, architectureSectionBytes:10225} exit 0.", "Красный прогон при пределе 8 192: exit 1 с сообщением «docs/ARCHITECTURE.md is 10207 bytes and the architecture section budget is 8192: raise ARCHITECTURE_LIMIT_BYTES»; зелёный: 25 тестов, pass 25, fail 0.", "Хеш состояния не изменился от правки предела: hashEqualsRawInput true — считается от сырого файла."]
resultSummary: "Предел раздела архитектуры поднят до 12 288 байт: файл 10 207 Б приходит целиком, маркера нет, последняя строка на месте; тест различает «целиком» и «обрезано с маркером», хеш считается от сырого файла."
role: BACKEND
scope: [plugins/state-feed/lib/feed.mjs, plugins/state-feed/test/]
---

Подними предел раздела архитектуры в первом сообщении с 8 192 до 12 288 байт и докажи, что текущий файл приходит целиком. Сейчас docs/ARCHITECTURE.md — 10 207 Б, значит фид режет его и ставит маркер, то есть оркестратор видит неполную архитектуру. Сделай: (1) константа предела 12 288; (2) тест: на файле 10 207 Б раздел приходит целиком и маркера нет, а на искусственно большом файле маркер есть и указывает путь; (3) приложи размеры первого сообщения до и после. Верни: новые размеры и коды прогонов.
