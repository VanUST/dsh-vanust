---
id: TASK-035
kind: task
title: "Notify only on real completion, root sessions only, one aggregated popup"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.375Z
updatedAt: 2026-11-17T15:52:39.375Z
acceptance:
  - text: "a child/subagent agent never produces a line"
    done: false
  - text: "two sessions finishing produce one popup with two lines"
    done: false
  - text: "a session that resumes inside the settle window does not appear at all"
    done: false
  - text: "the overlay still appears on this host (selftest) and the dismissed popup clears the list"
    done: false
boardId: task-mw9dtvk4-0badvk
nonScope: ["the harness's agent/status semantics", "macOS/Windows layout beyond keeping the body multi-line and the height growing", "any change to token accounting"]
resultArtifacts: [/home/iustimov/dsh-kit/plugins/notify/notify-core.mjs, /home/iustimov/dsh-kit/plugins/notify/plugin-notify.mjs, /home/iustimov/dsh-kit/plugins/notify/README.md, /home/iustimov/dsh-kit/plugins/cc-dsh-notify-1.1.3.tgz, /tmp/notify-crop.png]
resultEvidence: ["node /tmp/notify-probe.mjs -> 9/9 PASS: root notifies; delegate_task child silent; subagent child silent even at depth 0; one line per finished session; two sessions -> one body with two breaks; resumed session drops its line; overlay gets DSH_NOTIFY_LINES=2 with the breaks; daemon passes -r 4242; 12 sessions render as 8 lines + 'more'", "node /tmp/notify-e2e.mjs (real apply() with a stub notifier) -> 7/7 PASS, calls: 1 line after settle; continuation inside the window draws nothing; two sessions -> ONE card with 2 lines; subagent draws nothing; resumed session drops its line", "real overlay on :1 with a 3-line body, captured: /tmp/notify-crop.png shows '3d - WP2 - finished after 93s' / 'dsh-kit - notify - asks: which port...' / 'autolabel - #7c1a - finished after 412s' in one grown card", "node scripts/notify-selftest.mjs --dismiss-ms 1500 -> 'overlay started - it claimed a stack row', exit 0", "pack 1.1.2 -> 1.1.3 (sha 39827507...), pnpm add into the profile, diff kit vs installed notify-core.mjs and plugin-notify.mjs -> identical", "dsh --profile web --dump-config -> exit 0, no warnings, notify row carries settleMs: 8000", "check-portability 17/17 PASS, check-documentation ok; a stale persistent popup from the OLD build (pid 1779658, started 17:56) was found on the desktop and killed - the same pile-up the change removes"]
resultSummary: "Notify 1.1.3 (installed, restart pending): a card now fires only for a root session that STAYED idle through settleMs (8s default), so a goal continuation cancels its intermediate line; children are filtered by all three marks (delegationDepth, parentSession, origin 'subagent') because a subagent child can report depth 0; and finished sessions share ONE card with one line per session, replaced as sessions join and cleared by one dismissal. The overlay grows to fit its lines and the Linux daemon path reuses one bubble id (-r 4242) instead of stacking."
scope: ["plugins/notify/notify-core.mjs (isCoreAgent, body normalisation, overlay height, finish aggregator)", "plugins/notify/plugin-notify.mjs (settle timer, aggregation, single overlay process)", "plugins/notify/README.md and the profile config row"]
---

The notify plugin pings on every turn boundary, including subagent turns and goal-driven intermediate rounds, and raises a separate persistent popup per event that must be dismissed one by one. Change it to: (1) fire only for root chat agents (a child carries parentSession/origin 'subagent' even when delegationDepth is 0), (2) wait a settle window after running->idle so a continuation inside the window suppresses the popup, (3) keep ONE popup whose body has one line per finished session instead of a stack, dismissing them all at once.

Migrated from .dsh/taskboard.json (task task-mw9dtvk4-0badvk, revision 2).
