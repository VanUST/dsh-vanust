---
id: TASK-012
kind: task
title: "Add Kimi K3.1 models to the DSH Kimi route"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.093Z
updatedAt: 2026-11-17T15:52:39.093Z
acceptance:
  - text: "The kimi-coding route lists k3.1-pro and k3.1-pro-highspeed in the Models page / model picker"
    done: false
  - text: "A request through the route succeeds with the stored key"
    done: false
  - text: "The row lives in /home/iustimov/dsh-kit/profile/cordis.patch.yml so a kit update reproduces it"
    done: false
  - text: "No secret value appears in any file under the kit"
    done: false
boardId: task-mvyyrkmv-e91ltx
nonScope: ["Do not print or commit the API key value", "Do not change the deployment default model or flash-guard policy", "Do not upgrade @earendil-works/pi-ai or repack plugins"]
resultEvidence: ["curl GET https://api.kimi.com/coding/v1/models with the stored key → HTTP 200, ids: kimi-for-coding(1048576), kimi-for-coding-highspeed(262144), k3(1048576), k3-256k(262144), k3.1-pro(1048576), k3.1-pro-highspeed(1048576)", "curl POST /coding/v1/chat/completions model=k3.1-pro max_tokens=131072 reasoning_effort=high → HTTP 200, content \"dsh-kimi-ok\"", "dsh --profile headless --patch .cache/kimi-headless-patch.yml \"Reply with exactly the text dsh-kimi-ok\" → stdout dsh-kimi-ok, exit 0", "dsh --profile headless --patch .cache/kimi-headless-patch-hs.yml \"Reply with exactly the text dsh-kimi-hs-ok\" → stdout dsh-kimi-hs-ok, exit 0", "python-free schema check: importing the adapter's Config and parsing the row → 6 models with the declared ctx/max/efforts", "node scripts/kit-update.mjs --apply → actions=write-profile-files; diff -q profile/cordis.patch.yml $DSH_HOME/profiles/web/cordis.patch.yml → identical", "grep -rl 'sk-kimi-' over the kit (minus node_modules/.git) → 0 files", "first headless run failed INVALID_CONFIG naming supportsMidConvoSystemMessages: proof the compat gate refuses catalog-owned switches; both fields were dropped"]
resultSummary: "Kimi is a working second provider in DSH. The real key replaced the placeholder in $DSH_HOME/.credentials.yaml (mode 600, referenced as KIMI_CODING_API_KEY, never stored in YAML). The kimi-coding route now carries an explicit six-model catalog — k3.1-pro and k3.1-pro-highspeed both at 1048576 context, plus k3, k3-256k, kimi-for-coding, kimi-for-coding-highspeed — declared in the kit's profile/cordis.patch.yml and projected to $DSH_HOME/profiles/web/cordis.patch.yml (files identical). Both 3.1 models answered real requests through DSH's own adapter in a headless run. Remaining step for the operator: restart `dsh web`, because the running host composed its profile at boot and does not watch the patch file."
scope: ["/home/iustimov/dsh-kit/profile/cordis.patch.yml (durable provider row)", "$DSH_HOME/profiles/web/cordis.patch.yml (installed projection, written by kit-update)", "scripts/kit-update.mjs --apply to project the kit patch", "read-only inspection of $DSH_HOME/.credentials.yaml for the KIMI_API_KEY reference"]
---

The user added a Kimi Code API key through the Models page and wants the K3.1 family (k3.1-pro, k3.1-pro-highspeed) selectable in DSH for the `kimi-coding` route, and the result to survive kit updates. Deliver: the kimi-coding provider route present in the kit's profile patch (not only the installed copy), its model catalog carrying the 3.1 models with correct context/output caps, the key resolved per request through KIMI_API_KEY, and proof that the route lists the 3.1 models and answers a request.

Migrated from .dsh/taskboard.json (task task-mvyyrkmv-e91ltx, revision 5).
