---
id: TASK-245
kind: task
title: "Убрать класс ошибок «unidentified message»: починить старые логи и закрыть источник"
status: done
revision: 3
createdAt: 2026-11-18T16:21:34.787Z
updatedAt: 2026-11-18T16:30:49.204Z
acceptance:
  - text: "Повреждённых логов больше нет: scan возвращает 0 need repair, каждая отремонтированная сессия открывается"
    done: false
  - text: "Ни один новый лог не получает user/message без id (проверка после ремонта)"
    done: false
  - text: "Патч харнесса восстанавливается kit-update после переустановки и проверяется одной командой"
    done: false
  - text: "Сессия, которая раньше не открывалась, открывается в рабочем GUI"
    done: false
boardId: task-mwmbwjd3-6i94ke
chore: true
choreReason: "Дефект харнесса и продюсера state-feed делает сессии нечитаемыми; ремонт и защита не ложатся ни на одно существующее требование (REQ), это починка инструмента."
inline: true
resultArtifacts: [scripts/harness-identity-guard.mjs, scripts/session-repair.mjs, plugins/state-feed/lib/feed.mjs]
resultEvidence: ["node scripts/session-repair.mjs repair --apply --max-age-minutes 0 -> 'session-repair: 295 log(s), 6 need repair, 6 repaired, 0 skipped, 0 failed', backups under /home/iustimov/.npm/dsh/sessions-backup/2026-11-18T16-22-00.513Z..T16-22-02.421Z/", "harness validator over every event of the six repaired logs (adoptSessionEvent from @deepseek-ai/dsh-session 0.2.2-rc.3): 'validator: 6 log(s), 0 refused' (2770, 5066, 1558, 2352, 4238, 1480 events accepted)", "node scripts/session-repair.mjs scan -> '295 log(s), 0 need repair', exit 0", "red: node scripts/harness-identity-guard.mjs --probe after --revert -> 'load: refused: session event at seq 7 lacks an identified message; write: appended without an id', exit 3", "green: after --apply -> 'load: adopted id=recovered-1b4c142b...; write: appended id=80cb08de...', exit 0", "a simulated reinstall (--revert, then the boot path node scripts/kit-update.mjs --apply --no-harness --no-tools --keep-model-config) -> action patch-harness-identity, log 'harness.identity-guarded ... sha256=fc8aaea7...'; --check exit 0 afterwards", "make verify -> 'identity-guard: patched', 0 red (0/8 presets within budget is a pre-existing warning, not part of this change)", "node --test plugins/state-feed/test/feed.test.mjs -> 7 tests, 7 pass (including 'every injected message carries a fresh identity')", "live session after the fix (session-f0d9e4f9): scan of that log -> 0 need repair, i.e. the running server writes identified state-feed messages", "commit f3873b7 (7 files) pushed: d4de360..f3873b7 main -> main"]
resultSummary: "Шесть повреждённых логов отремонтированы (с бэкапом, каждый проверен штатным adoptSessionEvent), сканирование хранилища чистое (295 логов, 0 требуют ремонта). Класс закрыт на уровне харнесса: патч dsh-session проставляет id при записи (любой продюсер) и детерминированный id при чтении легаси-лога; патч идемпотентен, переустанавливается kit-update на каждом старте и проверяется make verify. Доказано red→green: до патча загрузка отказывала реальной ошибкой, после — событие принимается. Коммит f3873b7 отправлен в origin/main."
steps: ["Отремонтировать 6 повреждённых логов (backup, atomic write) и подтвердить валидатором харнесса", "Проверить, что сессия после фикса не пишет сообщений без id", "Написать патч-скрипт identity-guard для dsh-session и dsh-session-persistence (check/apply/revert/probe)", "Закрепить патч в kit-update и в проверке (session-doctor / make verify)", "Доказать red→green на синтетическом логе и на реальной сессии в браузере", "Отчитаться: причина, ремонт, защита, остаточные риски"]
stepsDone: 6
---

Сессии, в которые стейт-фид (state-feed) писал сообщение без id, не открываются: загрузка падает с «session event at seq N lacks an identified message», и вся история такой сессии теряется. Плагин уже исправлен и установлен (0.1.2), но старые логи остались битыми, а любой будущий продюсер может повторить ту же ошибку. Нужно: (1) отремонтировать шесть повреждённых логов с бэкапом и проверкой штатным валидатором харнесса; (2) закрыть класс на уровне харнесса — проставлять id при записи события (любой продюсер) и не отказывать при чтении легаси-лога; (3) закрепить патч так, чтобы переустановка харнесса его не стирала.
