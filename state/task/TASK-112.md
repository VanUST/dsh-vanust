---
id: TASK-112
kind: task
title: "Chat-scoped subagent reuse"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.426Z
updatedAt: 2026-11-17T15:52:40.426Z
acceptance:
  - text: "Из chat B delegate_task для роли, чей sleeping child создан chat A, НЕ вызывает sendMessage/startActivation на child A: создаётся новый child B."
    done: false
  - text: "Повторная delegation в chat A переиспользует child A, а не child B; chat B — child B."
    done: false
  - text: "Role с другим preset в chat B не получает preset_conflict от старой записи chat A; история старой роли сохраняется."
    done: false
  - text: "Новый chat не видит old child как reusable в role catalog/policy, но workspace history остаётся доступной человеку."
    done: false
  - text: "Proof воспроизводит две сессии и проверяет session ids из ledger/log, включая sleeping/restart случай; cleanup выполнен."
    done: false
boardId: task-mwevdsqs-y4o6d6
nonScope: ["Не запускать дополнительных subagents; работу выполнит существующий BACKEND после текущей задачи.", "Не менять Hindsight, Kimi, image-window, taskboard maxTasks semantics.", "Не удалять старые sessions/tasks; они остаются историей и не вызываются из нового чата.", "Не перезапускать live :3080 до отдельного подтверждения."]
owner:
  kind: agent
  label: BACKEND
  sessionId: df2a7125-9152-4106-9d22-c4f180fc00f7
ownerRole: BACKEND
preset: backend
resultArtifacts: [plugins/orchestrator/orchestrator.mjs, plugins/taskboard/taskboard.mjs, scripts/taskboard-chat-scope-proof.mjs, docs/cases/subagents-are-chat-scoped.json]
resultEvidence: ["node scripts/taskboard-chat-scope-proof.mjs -> 26/26 checks passed, exit 0; same proof on pre-fix modules in /tmp/pre-kit -> 9/26, exit 1.", "Red: chat B sendMessage to child-chat-a-backend, role reported re-created, ledger both chats child-1, different preset threw preset_conflict. Green: chat B creates child-1, A reuses child-chat-a-backend, A/B still reuse own after restart, no extra child.", "Real-ledger read-only classification: this chat's BACKEND df2a7125 is reusable; REVIEWER/RESEARCH/CRITIC/UX/DOCS are 'another chat' history; legacy rows have no conflict flags.", "make verify -> 17/17 portability/packaging, documentation ok; repacked @cc/dsh-orchestrator 0.1.39 and @cc/dsh-taskboard 0.1.54; :3080 untouched, real ledger unchanged."]
resultSummary: "Chat-scoped subagent isolation реализован и доказан. chatId определяется до role lookup; roster теперь per-(role, chat), foreign sleeping child не становится reuse target, cross-chat same-role/different-preset разрешён без preset_conflict, chat A продолжает переиспользовать своего child, workspace history остаётся в панели. Proof 26/26 green и 9/26 red на pre-fix; case verified automated. Изменения установятся на следующем boot через kit-update."
role: BACKEND
scope: ["plugins/orchestrator/** — chat ownership check перед reuse/sendMessage и role catalog", "plugins/taskboard/** — per-chat role discovery/registration semantics без потери истории", "profile/** только если нужен новый preset/config", "targeted proof и docs/cases для двух независимых chat sessions"]
---

Гарантировать, что новая сессия/чат никогда не вызывает и не переиспользует sleeping subagent, созданного другой сессией/чатом. Каждый чат получает собственные role/subagent contexts; существующий child переиспользуется только если он принадлежит текущему chatId. Одинаковая role с другим preset в новом чате не должна конфликтовать со старой записью другого чата.

Migrated from .dsh/taskboard.json (task task-mwevdsqs-y4o6d6, revision 10).
