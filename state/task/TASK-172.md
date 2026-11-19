---
id: TASK-172
kind: task
title: "Найти и проверить готовые инструменты дешёвого чтения кода для агентов"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.432Z
updatedAt: 2026-11-17T15:52:41.432Z
acceptance:
  - text: "не более 6 кандидатов, каждый с лицензией, последней версией и датой релиза, точной командой установки/вызова и URL каждого утверждения"
    done: false
  - text: "для каждого кандидата явно сказано, что именно он экономит: меньше байт при чтении файла, оглавление вместо тела, сжатие уже полученной выдачи, или кеш — это разные вещи"
    done: false
  - text: "для каждого кандидата сказано, нужен ли демон, сеть или модель, и работает ли он локально"
    done: false
  - text: "итоговый вердикт по каждому: принять / попробовать / отклонить, с одной строкой причины; отклонённые тоже названы"
    done: false
  - text: "минимум проверены: собственный режим чтения rtk (rtk read), инструменты оглавления на tree-sitter или LSP, карты репозитория в стиле aider repo-map, упаковщики репозитория в промпт (code2prompt/repomix/gitingest), MCP-серверы сжатия контекста"
    done: false
boardId: task-mwkigb1r-rde8sc
nonScope: ["ничего не устанавливать и не менять в репозитории /home/iustimov/dsh-kit", "не писать код и не заводить задачи", "не пересказывать по памяти: каждое утверждение с URL", "не оценивать Headroom и RTK — они уже измерены оркестратором"]
owner:
  kind: agent
  label: RESEARCH
  sessionId: 79186c86-ceb7-4c14-9d33-2142bff8507b
ownerRole: RESEARCH
preset: research
resultEvidence: ["repomix: https://repomix.com/guide/code-compress и релиз v1.19.0 (2026-11-08), MIT, команда `npx repomix@1.19.0 --compress`", "code-skeleton-mcp: registry.npmjs.org/code-skeleton-mcp, 0.1.3 от 2026-05-31, MIT, `npx code-skeleton-mcp outline <file> --depth 2`, tree-sitter WASM-грамматики вкоммичены, офлайн", "Serena: LICENSE репозитория oraios/serena — приложение GPL-3.0-or-later с v2, последний MIT-релиз v1.7.0; на машине уже стоит serena-agent 2.1.0 как опциональный набор поиска кода", "aider repo-map: https://aider.chat/docs/repomap.html, релиз v0.86.0 published_at 2025-08-09 (api.github.com/repos/Aider-AI/aider/releases/latest)", "mcp-language-server: BSD-3, релизов нет, pushed_at 2026-03-01 (api.github.com/repos/isaacphi/mcp-language-server)", "code2prompt 0.8.1 (2024-09-08) и gitingest 0.3.1 (2025-07-31) по pypi.org JSON — оба упаковщики, выдачу увеличивают", "rtk: релиз v1.2.0 от 2026-11-08 (api.github.com/repos/rtk-ai/rtk/releases/latest), в ките 1.1.0; страница https://www.rtk-ai.app/docs/commands/read отдала 404 — флаги `rtk read` не подтверждены"]
resultSummary: "Проверены по первоисточникам шесть кандидатов класса «дешёвое чтение кода» и отдельно rtk read. Вердикты: попробовать — repomix `--compress` (MIT, 1.19.0, 2026-11-08, tree-sitter вырезает тела, локально без модели) и code-skeleton-mcp (MIT, 0.1.3, 2026-05-31, tree-sitter WASM, офлайн, но один автор); отклонить — Serena (приложение с v2 под GPL-3.0-or-later, последний MIT-релиз 1.7.0), aider repo-map (не отдельный пакет, релизов с 2025-08-09), mcp-language-server (без релизов, последний коммит 2026-03-01), code2prompt и gitingest (складывают репозиторий в промпт, то есть увеличивают выдачу). Ключевой вывод: ни один кандидат не лечит измеренный перерасход, который приходится на чтение файлов через shell (sed 3,84 МБ, grep 2,71 МБ), — это привычка, а не отсутствие оглавления. rtk read существует (в ките rtk 1.1.0, вышел 1.2.0), но справочной страницы по флагам не нашлось, поэтому правило «читай через rtk read» пока не обосновано."
role: RESEARCH
scope: ["веб-поиск и чтение первоисточников: GitHub, npm, PyPI, официальные доки, changelog", "оценка применимости к харнессу DSH, у которого уже есть инструмент read с offset/limit, grep, glob и фильтры rtk"]
sessions:
  - sessionId: 79186c86-ceb7-4c14-9d33-2142bff8507b
    label: RESEARCH
    role: RESEARCH
    status: sleeping
---

Найти и проверить по первоисточникам готовые инструменты и аналоги, которые уменьшают контекст при чтении кода агентом: инструменты, возвращающие более дешёвое представление файла (оглавление, символы, диапазоны, сжатие выдачи), а не весь файл. Владелец dsh-kit просил посмотреть, что уже существует, прежде чем улучшать собственное правило чтения.

Migrated from .dsh/taskboard.json (task task-mwkigb1r-rde8sc, revision 6).
