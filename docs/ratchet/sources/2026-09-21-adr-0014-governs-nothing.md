# ADR 0014 governs nothing after ADR 0076

The 2026-09-21 corpus review raised a **warning**, kind `deprecated_decision`, against ADR 0014:
it is in force and declares no law in the current 79-law set, and its Decision prose describes a
channel the shipped panel no longer uses.

Measured, not inferred. ADR 0014's Decision says the panel's action clears by the ratchet's own
question through `user-questions/request`. Three things have changed since.

First, every law 0014 declared has left the bundle through a ratified amendment. ADR 0035 removed
`shipped-plugins.the-panel-offers-consent-only-through-the-question-channel`. ADR 0076 — ratified
by 0078 — removed the other two: `shipped-plugins.the-panel-records-no-consent-of-its-own` and
`shipped-plugins.the-question-seam-is-measured-from-the-panel-host`, restating both under new ids
whose notes describe the mechanisms the code actually contains. The compiled bundle attributes no
law to 0014.

Second, the consent path the prose names was replaced. ADR 0034 decided that the panel's Approve
and Decline record the decision through the panel's own host route, with no composer message and
no agent in the loop; ADR 0035 restated the executed-bundle guarantee around that route; and ADR
0043 recorded `adr-panel` as a second channel in the ratchet's closed vocabulary, distinct from
the harness seam's `user-question`. The panel host never reads `ctx.userQuestions` itself — its
consent route calls the ratchet's `ratchetConsent` service, which calls the same `ratify`
operation the `ratchet_ratify` tool calls. So 0014's prose is not merely unimplemented; it names
the wrong layer.

Third, 0014 cannot be edited, superseded, or given a terminal status by an agent. It was ratified
by 0016, so its text is frozen and an edit voids the consent; and a record that has lost all its
laws has no `op: remove` target left, while `supersedes` demands a terminal status the ratified
record cannot be given. That is the same wall ADR 0066 measured for ADR 0019, and it is why the
remedy is a recorded reading rather than a retirement.

The finding this record answers is that an active, ratified decision whose prose contradicts the
shipped mechanism misleads exactly the reader who goes looking for how consent works. Recording
the reading is what ADR 0066 did for ADR 0019, and this is the same treatment for the same
reason. Nothing is retired and no text is edited: 0014 stays active and frozen, and this record
is what a reader finds when they ask what it governs.
