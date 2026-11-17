---
id: TASK-051
kind: task
title: "Project rules editor: one cached prompt section, edited from the client"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.573Z
updatedAt: 2026-11-17T15:52:39.573Z
boardId: task-mwapi1jg-77vfa8
ownerRole: BACKEND
---

A client-side text editor for workspace-local rules that become one system-prompt section for every agent and subagent in the workspace, built so editing is cache-safe: typing never touches the model prompt, a save applies at the next turn's boundary, and the section text stays byte-identical within a turn and across untouched turns. Prove the cache behaviour by counting system re-renders and cache reads in a real session log.

Migrated from .dsh/taskboard.json (task task-mwapi1jg-77vfa8, revision 11).
