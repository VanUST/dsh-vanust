# @cc/dsh-image-window — keep only the newest images in the request

The harness satisfies a route's image-byte budget **reactively**: an adapter rejects the
request with `IMAGE_OFFLOAD_REQUIRED`, and `@deepseek-ai/dsh-compaction-image-offload`
removes the **oldest** image occurrences and retries. Removing an old message rewrites the
request prefix at that position, and every provider that caches a prefix re-bills everything
after it. Measured 2026-11-10 on `session-1cb0708d` (kimi-coding, 532K-token context, 95
pasted screenshots in 13 batches): six such offloads re-billed **1,783,829** of the session's
**2,260,222** fresh input tokens, each collapse leaving only the first ~75K tokens cached.

This plugin changes the policy to a **sliding window**: when a new image arrives, the one that
falls out of the window is offloaded immediately. The changed position is then one or two
messages back — the *tail* — so the re-billed suffix is the tokens of the new batch, not the
whole conversation. Replaying the same session under the window policy projects **440,944**
re-billed tokens instead of 1,783,829.

## Configuration

```yaml
- insert:
    - id: image-window
      name: '@cc/dsh-image-window'
      config:
        keepImages: 1    # how many of the newest images stay; raise it for image comparison
        # enabled: false
```

## What it does and does not do

- It listens for `user/message` / `tool/result` events, counts the non-offloaded images in the
  session surface, and appends one `image/offload` event per arrival that pushes an older image
  out. The projection it uses is the one the harness's image-offload plugin registers, so the
  two never disagree about what "offloaded" means.
- The harness's own reactive offload stays mounted as a safety net: a single image larger than
  the whole byte budget still fails once and is handled by the harness path.
- It never touches assistant output, and it never removes the newest image — the one the agent
  asked for.
