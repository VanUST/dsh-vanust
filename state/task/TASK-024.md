---
id: TASK-024
kind: task
title: "Reclaim ~102 GB of Docker disk on the PC"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.240Z
updatedAt: 2026-11-17T15:52:39.240Z
acceptance:
  - text: "docker system df shows images/volumes/build cache reclaimable near zero"
    done: false
  - text: "df -h / shows roughly +100 GB available"
    done: false
  - text: "/var/lib/docker measured size drops from ~200 GB"
    done: false
  - text: "autolabel/* tagged images and the two running containers still present"
    done: false
boardId: task-mw92a7n7-88owmg
nonScope: ["docker image prune -a (would delete tagged autolabel images)", "removing or restarting running containers", "deleting files outside Docker", "changing /etc/docker/daemon.json without the human's approval"]
resultEvidence: ["docker buildx prune -f → Total: 72.13GB (first pass)", "docker volume prune -a -f → Total reclaimed space: 13.97GB", "docker image prune -a (human) → 24 images untagged, Total reclaimed space: 0B, df 685G→648G used", "docker system df after that → Build Cache 75.2GB, RECLAIMABLE 73.88GB", "docker buildx prune -f → Total: 73.88GB, df 648G→572G used, 298G free", "final: docker system df Images 1.822GB / Build Cache 1.325GB / Volumes 75MB, all RECLAIMABLE 0B", "docker run ... du -sh /v → 4.0G (was 200G)", "docker ps: corrections-dev and autolabel-dev-postgres still Up"]
resultSummary: "Docker 200 GB → 4.0 GB; root filesystem 767 GB used / 103 GB free → 572 GB used / 298 GB free (195 GB freed in total). Three passes: (1) build cache 72.13 GB + named volumes 13.97 GB, (2) human's docker image prune -a untagged all 24 stack images (df 685→648 GB), (3) second buildx prune 73.88 GB once the cache stopped being pinned by images (df 648→572 GB). The recurring \"Total reclaimed space: 0B\" is a reference-counting artefact: layers shared between images and build-cache records are released only after both references drop, so images and cache must be pruned in that order."
scope: ["docker image prune -f", "docker builder prune -f", "docker volume prune -f", "read-only measurement of /var/lib/docker via a throwaway container mount"]
---

Free the space Docker holds invisibly under /var/lib/docker (~200 GB measured) by pruning dangling images (60, 62 GB), the build cache (1132 records, 26 GB) and unused volumes (8 of 11, 14 GB). Tagged/working images and volumes attached to containers must survive. Record before/after numbers as proof.

Migrated from .dsh/taskboard.json (task task-mw92a7n7-88owmg, revision 5).
