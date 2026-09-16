# A law's check must be hermetic

## The decision, verbatim

> **A law's check must be hermetic.** Probes that need a live webserver, a port or a nested
> process are release-gate evidence (`scripts/verify-upgrade.sh`), not law checks.

This is the settled response to the gate's red state. Six laws in force bound two end-to-end
probes:

- `node scripts/probe-dsh-api.mjs --adr-panel-consent` — 16/16, exit 0 when a human runs it,
  but it mounts a real webserver on a port and boots a nested `dsh` process.
- `node scripts/probe-dsh-api.mjs --ratchet-ratify` — 10/10, exit 0 when a human runs it, but
  it drives a live root agent through the harness user-questions channel.

The verifier's command runner starts those probes in a context that differs from a shell, and
the measurement of exactly which runner-level fact breaks them (a timeout, an environment
variable, a nested process, a port, the working directory) has not been made. What was
decided is not to chase the runner, but to stop making law force depend on an environment
the law gate does not control.

## Why an amendment rather than an edit

The six laws are in force through human ratifications:

| Law | Declared in | Ratified by |
|---|---|---|
| `shipped-plugins.the-consent-route-is-not-a-second-consent-path` | ADR 0034 | ADR 0041 |
| `shipped-plugins.a-consent-names-the-surface-that-carried-it` | ADR 0034 | ADR 0041 |
| `shipped-plugins.the-consent-route-is-unreachable-by-an-agent` | ADR 0034 | ADR 0041 |
| `shipped-plugins.a-consent-travels-a-channel-it-records` | ADR 0035 | ADR 0042 |
| `shipped-plugins.the-panel-window-is-a-surface-of-one-consent-operation` | ADR 0035 | ADR 0042 |
| `shipped-plugins.the-question-seam-is-measured-by-the-probe` | ADR 0019 | ADR 0023 |

Editing any of those records voids the consent that put it in force, and re-declaring an id a
ratified record still declares is the corpus contradicting itself. The removal and the
restatement therefore ship as one amendment ADR: `op: remove` for each old id, and `op: upsert`
for each restated law under a NEW id, because the compiler refuses a remove and an upsert of
one id in one record.

A proposed record adds no law and removes none: until a human ratifies this amendment the six
old laws stay in force bound to the probes, and the gate's colour is the probes' colour. After
ratification the six old laws leave force and the six restated laws enter it bound to the two
hermetic commands.

## The hermetic replacements, and exactly what they assert

Only two commands are hermetic replacements:

- `node scripts/check-consent-surface.mjs` prints `consent surface ok` only after every claim
  held. It drives the consent service the panel's route reaches, directly, with no server and
  no nested process. Among its claims: *"the CLI has no mint verb"*; *"and inventing its flags
  does not mint either"*; *"a label with no quiz behind it mints nothing"*; *"a quiz the
  ratchet did not build mints nothing"*; *"a record whose zone forbids agent-held force mints
  nothing"*; *"the ratchet provides the consent service the route reaches, with the three
  operations"*; *"asking the service prepares the ratchet's question and writes nothing"*;
  *"the ratchet's own question, answered with its own label, writes the approval and its
  transcript"*; *"a consent recorded through the route names the route as its channel, in the
  approval and the transcript"*; *"a replayed quiz mints nothing, because the record is no
  longer waiting"*; *"the ratchet's own reject label records a decline and writes nothing"*;
  *"an answer about a record edited since the question was asked mints nothing"*; *"a stale
  refusal leaves the decision waiting, so it can be asked again"*; *"the panel and its host
  agree on the route, the service, the header and the capability global"*; *"the panel knows
  every channel a ratification can have been obtained through"*; *"no tool exposes the consent
  route, its service, its header or its capability"*; *"the tool exposes no argument that
  accepts an answer"*; *"the panel matches the intent the ratchet sends, and a grill gets no
  intent to claim"*.
- `node scripts/test-adr-panel.mjs` prints `adr panel render ok` only after executing the
  shipped browser bundle against a stub host. Among its claims: *"a ratifiable decision offers
  Approve and Decline on its own row"*; *"an Approve click asks the host route for the
  ratchet's own question about THAT record"*; *"the panel sends the ratchet's own approve
  label, paired with the question it came from"*; *"the ratchet reads the row's approve click
  as an approval, not an unreadable answer"*; *"a Decline click sends the ratchet's own reject
  label with the same question"*; *"the ratchet reads the row's decline click as a rejection"*;
  *"the row puts the ratchet's question, the record's own text and both of its labels on
  screen"*; *"and the outcome names the approval and its transcript, so nothing is recorded
  invisibly"*; *"a decision the ratchet has no question for is reported, and no answer is
  sent"*; *"with no capability the row names the CLI command instead of offering a button"*;
  *"and it fetches nothing at all in that state"*; *"no panel ratification composes a composer
  message, in any scenario driven above"*; *"the intent kind the panel matches is the one the
  ratchet sends"*; *"a grilling session's question carries no panel intent, so the seat leaves
  it alone"*; *"the panel also claims the ratchet's re-ask shape (a non-empty `previous`
  list)"*; *"the panel derives exactly the waiting set the ratchet reports over the kit's own
  corpus"*; *"and every decision it derived that from was read byte-exactly, not from a page"*.

## The narrowing, stated openly

The old statements were written when a law could name the probe's measurement. The restated
statements say only what the two hermetic commands actually assert, and where the old text
named something only the live probe can show, the restatement drops it and the live part stays
in `scripts/verify-upgrade.sh`:

- **The route over real HTTP.** The service is driven directly; an unauthenticated loopback
  request actually being refused, and a browser session with a missing or tampered capability
  actually being refused before the ratchet is reached, remain probe measurements.
- **The harness browser trust fence.** The claim that every request must pass
  `connection.requestRejection` is a harness fact measured by the probe; hermetic checks can
  only assert that the panel and its host agree on the route's four values and that no tool
  surface exposes them.
- **The live profile and the live root agent.** The ratification question reaching a real
  human channel, its presentation intent surviving the wire, and an approval putting the
  decision into force against a live profile are end-to-end probe measurements. The hermetic
  commands assert the question's shape, its re-ask shape, the label-derived answer and the
  recorded channel against the module, not against a live session.
- **A Session's `user-question` channel.** The service mints under the route's channel; that a
  consent obtained through the harness seam records `user-question` is not driven by either
  hermetic command and is not restated.
