---
id: TASK-323
kind: task
title: "The live snapshot has no agents line although the installed build writes one"
status: done
revision: 6
createdAt: 2026-11-26T10:02:14.052Z
updatedAt: 2026-11-26T10:07:21.810Z
acceptance:
  - text: "the writer of the live state/views files is named with file:line, and the reason the installed 0.1.17 does not produce the agents line is stated as a mechanism, not a guess"
    done: false
  - text: "the fix makes a live state write produce the line with the installed build, or names precisely what external action is required and why the code cannot do it"
    done: false
  - text: "a proof shows the line present in state/views/snapshot.md after a state write, with the journal sequence quoted before and after"
    done: false
  - text: "a second proof shows the counter reading a non-zero agents figure when a session is recorded as working, and zero when none is"
    done: false
  - text: "make test and make verify are green and the plugin is repacked if it changed"
    done: false
boardId: task-mwxdvh3k-k53sw5
chore: true
choreReason: "The installed project-state 0.1.17 does not write the 'active agents' line into the live snapshot, so the counter will under-report as soon as an agent is actually working."
nonScope: ["No change to what the counter means or to the list", "No install, no restart", "No commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["writer named with file:line on the installed package: lib/core.mjs:662 regenerateViews -> lib/views.mjs:265 renderViews -> :272 snapshot.md -> :214 renderSnapshot", "the 0.1.16 tarball has 0 occurrences of 'active agents' and the installed 0.1.17 has 1; the write at seq 1817 came from the old module, seq 1818-1820 from the new one", "live file now carries '- active agents: 1' at last journal seq 1820, while the committed b17da57 snapshot lacks it", "the mechanism reproduced on this runtime: import old-build, rewrite the file, import the same URL -> still old-build; a fresh URL -> new-build", "counter with a working session: unclosed 1, active 1, agents 1; with every recorded session settled through the product's own path: agents 0 and '- active agents: 0'", "make test 69/69 and make verify exit 0; no product file changed and nothing repacked"]
resultSummary: "No source defect: the live views are written by the running server's loaded copy of @cc/dsh-project-state, and at the moment the projection lacked the agents line that process was still executing 0.1.16, with 0.1.17 landing later. Node caches an ES module by URL for the process lifetime, so the package replaced on disk is not the code running; after the restart the next writes carry the line (seq 1818-1820, file written 13:02:18) and the counter reads a real figure: agents 1 while a session is recorded working, 0 when all are settled. Nothing changed in the code; both gates green."
role: BACKEND
scope: ["plugins/project-state — the live view writer", "scripts/state-merge.mjs or any other module that renders views, if that is the writer that runs", "tests for the writer path"]
---

Find out why the live projections do not carry the agents line even though the installed build contains it. The workspace generator writes '- active agents: N', the installed package is 0.1.17 with the same code, the journal advanced to 1817 after the reload, and state/views/snapshot.md still has no such line. Name the module and the call that actually writes state/views in the running setup, say why it did not produce the line, and fix the path that runs — not the one that does not. Prove it with the product: a state write leaves the line in the file, with the journal sequence before and after quoted, and the counter reads a non-zero agents figure while a session is recorded as working.
