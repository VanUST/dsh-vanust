---
id: TASK-285
kind: task
title: "B3: прокси только для OpenAI — транспорт в адаптере (HTTP и SOCKS5)"
status: done
revision: 1
createdAt: 2026-11-23T08:44:02.289Z
updatedAt: 2026-11-23T08:44:02.289Z
boardId: task-mwm0hkio-hge31m
ownerRole: BACKEND
---

Дать адаптеру OpenAI собственный прокси-транспорт, чтобы через VPN-выход шли ТОЛЬКО запросы к OpenAI, а остальной харнесс оставался напрямую. Сейчас адаптер использует global fetch, и единственный доступный рычаг — общепроцессная политика DSH, которая проксирует всё; для «прокси только для OpenAI» нужен транспорт внутри адаптера: HTTP(S) через createRouteDispatcher/proxyRouteFor из @deepseek-ai/dsh-http-proxy, SOCKS5 — отдельным коннектором (политика DSH SOCKS не умеет). Прокси задаётся в конфиге адаптера, учётные данные — из credentials.

Migrated from .dsh/taskboard.json (task task-mwm0hkio-hge31m, revision 8).
