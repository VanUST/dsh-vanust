---
id: TASK-312
kind: task
title: "Commit the finished work by path and push it"
status: done
revision: 6
createdAt: 2026-11-24T13:10:36.266Z
updatedAt: 2026-11-24T13:16:40.279Z
acceptance:
  - text: "every path staged belongs to this session's work and no scratch or unrelated path is included; the proof is the quoted git status before, the staged list, and the diffstat"
    done: false
  - text: "the commit exists with a message that describes the change in product terms and names no agent, session or tool internals"
    done: false
  - text: "the working tree state after the commit is quoted: what remains unstaged and why"
    done: false
  - text: "the push succeeded with the remote HEAD moved to the new commit, proven by ls-remote and by comparing it to the local HEAD"
    done: false
  - text: "if the push hits a transport failure, the workaround used is quoted (protocol version, retries) and the final ls-remote proves the result rather than the exit code"
    done: false
boardId: task-mwupq0tg-gt4ecr
chore: true
choreReason: "The owner asked for the finished work to be committed and pushed: the design map redesign, the state-feed fix, the case-id fix and the guards that followed from them, in a tree several agents have edited."
nonScope: ["No install, no kit-update, no server restart", "No change to any product file: this task stages, commits and pushes what exists", "No cleanup of other agents' work in progress"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["before: 286 dirty entries (112 untracked, 109 deleted, 65 modified)", "git add --pathspec-from-file=.dsh/stage.txt; staged name-status: 32 A, 108 D, 58 M, 1 R061; shortstat 199 files changed, 10013 insertions, 147331 deletions", "read-back after the commit: git status --porcelain for every planned path prints 0", "commit ce78641 'Design map v2 as drawn pages, and a state feed that cannot stall a turn'", "git -c http.version=HTTP/1.1 push origin main -> d37fd2d..ce78641 main -> main; ls-remote refs/heads/main = ce786417bd2294d809c063ea08fd7ab5f22ca7dd = git rev-parse HEAD", "make test 68/68 exit 0 and make verify exit 0 on the committed tree"]
resultSummary: "The finished work is committed and pushed: 199 files staged from an explicit 200-path allow list built out of the full dirty status, nothing scratch or another workstream's work included, and the commit is ce78641 'Design map v2 as drawn pages, and a state feed that cannot stall a turn'. The push landed on the first transport variant and the remote main equals local HEAD (ce786417bd2294d809c063ea08fd7ab5f22ca7dd). The committed tree passes make test 68/68 and make verify 20/20. The project ledger under state/ was deliberately left to its own merge pass and is being committed separately."
role: BACKEND
scope: ["git index and commits in /home/iustimov/dsh-kit", "the push to the configured remote"]
---

Commit and push the finished work in a shared dirty tree, without absorbing anyone else's unfinished edits. Stage by explicit path: the design-map redesign (plugin 1.0.1 with the page store, the four tools, the bundle patch, the editor inside Project state -> Map, the retired v1 and the decoupled analysis record), the state-feed fix that delivers the delta through the pre-step decision instead of the session inbox, the case-id fix for Russian titles with its repacked plugin, the taskboard guard that pins the new designmap contract, the profile rows and personas, and the docs and recorded-case changes that belong to them. Leave out every scratch path (.dsh, .proof-*, .cache, reports, logs, temporary home copies). Quote git status before, the staged list and the diffstat, then commit with a message that says what changed for the product, and push. Prove the push by comparing the remote HEAD with the local one, not by an exit code.
