---
id: TASK-329
kind: task
title: "State batching and parallel work in the policy, and let the architect search the web"
status: done
revision: 7
createdAt: 2026-11-26T12:39:59.532Z
updatedAt: 2026-11-26T12:56:32.977Z
acceptance:
  - text: "the orchestrator's policy text states batching as the default strategy: several tasks of one kind go to ONE agent whose role fits, with the board still carrying each task's own acceptance and evidence"
    done: false
  - text: "the policy text states that checks batch too: one seat measures a batch's cases, one review covers several rows, and the gate runs once at the boundary of the batch"
    done: false
  - text: "the policy text states maximal parallelism without intersections: when two or more tasks touch nothing in common they start together, and it names what serialises them (a shared file, a shared contract, a shared seat)"
    done: false
  - text: "the text is added to the existing paragraphs where already present, not appended as a duplicate section"
    done: false
  - text: "the architect preset declares the web tools and its persona no longer says it cannot browse; the change is proven by a composed config dump naming the web tool under preset-architect"
    done: false
  - text: "a fresh session with the architect preset on a second server shows the web tools in its request header, or the exact reason that proof needs a restarted deployment is quoted"
    done: false
  - text: "every doc that lists a preset's tools names the architect's web tools, make verify and make test are green, and every plugin whose packed files changed is repacked"
    done: false
boardId: task-mwxjidfw-o7c4z8
chore: true
choreReason: "The owner asked for the batching and parallelism strategy to be stated in the orchestrator policy, and for the architect preset to be able to search the web."
nonScope: ["No new role and no new preset: the role count stays as it is", "No change to the ARCHITECT's read-only file policy (write/edit stay false)", "No change to /home/iustimov/tasks/autolabel_pipeline", "No install, no commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["policy at plugins/orchestrator/orchestrator.mjs:434, :461 and :475 — batching default, checks batched into one seat with one review for 2-8 rows, gate once at the batch boundary, three serialisers named", "composed config dump: preset-architect carries tool-web and the persona line about searching the web; the architect allow row lists web_fetch and web_search", "no 'cannot browse' remains in profile/cordis.patch.yml", "copies updated: scripts/tool-families-proof.mjs, scripts/audit-preset-composition.mjs, rules/DEPLOYMENT.md; tool-families proof 113/113", "make test 70/70 and make verify 20/20 exit 0; orchestrator repacked 0.1.70 matching its sources", "header proof not obtained and the reason quoted: the harness home is read-only here (EROFS) and a copied home stops at MISSING_CREDENTIAL with the headless default preset"]
resultSummary: "The orchestrator policy now states batching as the default and parallel work without intersections, inside the three paragraphs that already carried it: several tasks of one kind go to ONE agent whose role fits (the default, not an optimisation), each task keeping its own acceptance and evidence; checks batch the same way into one seat, one review covering 2-8 rows, the gate once at the batch boundary; and the only things that serialise work are a shared file, a shared contract or a shared seat. The architect preset declares tool-web, its persona line about not browsing is gone and now says to search when the decision needs a fact, and the tool-families allow row carries web_fetch and web_search so the row and the declaration stay in step. The composed config dump proves both; the fresh-session header proof was not obtained because the harness home is read-only here and a copied home stops at MISSING_CREDENTIAL with the headless default preset. Gates green, orchestrator repacked 0.1.70."
role: BACKEND
scope: ["plugins/orchestrator/orchestrator.mjs — the policy paragraphs", "profile/cordis.patch.yml — preset-architect's plugin list and persona", "scripts/tool-families-proof.mjs and the docs that list preset tools", "plugin package versions and tarballs for every plugin whose packed files changed"]
---

Two changes to the agent configuration of this kit. First, the orchestrator's policy: state batching as the default strategy — several tasks of one kind go to ONE agent whose role fits, one brief per task but one seat, each task keeping its own acceptance and evidence; checks batch the same way, one seat measuring a batch's cases and one review covering several rows, with the gate running once at the batch boundary; and maximal parallelism without intersections — whenever two or more tasks touch nothing in common they start together, and the text names what serialises them. Extend the paragraphs that already say part of this instead of appending a second policy. Second, give the architect preset internet search: declare the web tools in preset-architect, correct its persona which currently says it cannot browse, fix every doc and proof copy that lists a preset's tools, repack what changed, and prove on a second server that the composed preset carries the web tools and that a fresh architect session's request header shows them.
