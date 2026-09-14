# Ratchet design session

The user approved a Ratchet v2 design: a local architecture compiler that turns
ADR records into enforced laws, verifies code against them deterministically, and
reserves meaning-level questions for an agentic review layer.

Three requirements shaped every later decision:

1. The deterministic layer must be the gate, because a check that can fail a build
   and depends on a model is one people learn to re-run until it passes.
2. Agent autonomy must be per zone and explicit; an agent may never silently
   override a human decision.
3. Every rule must have an enforcement point, because a rule nothing fails against
   is prose.

The session also fixed the target: 2x Linux and 1x Windows machines, which is why
portability is treated as a shipped-source property rather than a testing habit.
