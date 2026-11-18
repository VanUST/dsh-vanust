# Передача: экосистема оркестрации + аудит плагинов + impeccable (2026-11-18)

## Где мы

- Репозиторий `/home/iustimov/dsh-kit`, HEAD `4a645cc`, дерево чистое (кроме нового `docs/analysis/impeccable-design-quality.json`).
- Прошлая программа закрыта: запись `docs/analysis/project-state-ecosystem.json` в статусе `completed`, **20 требований доказаны**, 1 отложено (FR16 — механический запрет записи воркеру), `make verify` 17/17, 188 тестов, 15 proof-скриптов, всё запушено (`origin/main = 4a645cc`, сверено `ls-remote`).
- **Установленный профиль `~/.npm/dsh/profiles/web` — СТАРЫЙ**: 23 плагина, `orchestrator 0.1.45`, `taskboard 0.1.56`, `analysis 0.1.9`, `designmap 0.1.15`, `tool-families 0.1.5`. Нет `project-state`, `state-feed`, `delegation-brief`, `project-state-panel`. Перезапуск сам по себе ничего не обновит.

## Что в работе прямо сейчас

- `task-mwlxjgdd-yvh1bx` (A1, BACKEND активен) — аудит плагинов: вызовы по журналам, мёртвые инструменты, байты схем, дорогие результаты. При перезапуске харнесса **этот child умрёт**, его отчёт потеряется; задача останется в ledger со статусом active.
- `task-mwlxo6cu-529m2f` (U1, открыта, не делегирована) — провижн impeccable: скилл + движок с пином, `make design-audit`.
- `task-mwlxo6k5-feshqa` (U2, открыта, не делегирована) — UX-процесс: существующий проект → детектор → правка → повторный прогон; новый проект → PRODUCT.md/DESIGN.md; мокапы 2–4 варианта + скриншоты + страница сравнения. U2 идёт после U1.

## Что выяснено про impeccable (внешний источник, не наш код)

- `pbakaus/impeccable` (112k звёзд), npm `impeccable@4.9.2`; DSH-скилл `.dsh/skills/impeccable/` = `SKILL.md` + `reference/` (46 плейбуков) + `scripts/` (лаунчер `impeccable` 13.7 КБ, `engine-checksums.txt`, `VERSION`, `live-browser*.js`, `data/`).
- Движок — платформенный бинарник (`@impeccable/cli-linux-x64@0.1.25`), сверяется по `engine-checksums.txt`; детектор — 62 правила, `--json`, exit 2 = находки.
- Сайт `impeccable.style` с этой машины недоступен (DNS отдаёт 8.6.112.0, таймауты; публичные резолверы 1.1.1.1/8.8.8.8 заблокированы). `api.github.com` и `registry.npmjs.org` работают с ретраями.
- Запись анализа: `docs/analysis/impeccable-design-quality.json` (rev 2, ready, 8 требований, 4 решения).

## Следующий шаг

1. Дождаться/снять A1, закрыть её по факту (если child умер — переделегировать с нуля, brief в задаче уже содержит всё).
2. Делегировать U1 (BACKEND, `taskId: task-mwlxo6cu-529m2f`) с `analysisId: impeccable-design-quality`, `requirementIds: FR1, FR5, NFR1`.
3. После U1 — U2 (UX/UI, `taskId: task-mwlxo6k5-feshqa`, FR2/FR3/FR4).
4. Только потом — обновление установленного профиля владельцем: остановить `dsh web`, `node scripts/kit-update.mjs --apply`, запустить заново. **Гард кита отказывает в пине, пока `dsh web` запущен.**

## Ловушки, которые не надо повторять

- Тарбол панели исчезал трижды, потому что `pack-plugin.mjs` удалял чужие версии по префиксу: `cc-dsh-project-state` — префикс `cc-dsh-project-state-panel`. Починено (регэксп с цифрой версии), но при новых плагинах с общим префиксом проверяй `make verify`.
- Push падает на `gnutls_handshake` примерно в половине случаев: ретраить с `-c http.version=HTTP/1.1` или `=HTTP/1.0`, **никогда не читать код возврата через конвейер** (`git push | tail` даёт статус `tail`). Навык: `push-dsh-kit-when-gnutls-handshake-fails`.
- Закрытие задачи с `task_close` прерывает связанных детей; роль BACKEND — ОДНА сессия, второй brief в неё не отправлять, пока первая задача не закрыта.
- `analysis_upsert` заменяет массивы целиком; удалять ссылки на задачи из ready-записи нельзя; `expectedRev` обязателен.
- `make verify` не должен тянуть сеть: `make design-audit` держать отдельной целью.
- Панель состояния уже написана (`@cc/dsh-project-state-panel` 0.1.8) и проверена на втором порту; в живом профиле её нет, пока профиль не обновлён.
