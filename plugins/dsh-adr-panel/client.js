/**
 * PURPOSE
 *   Browser half of the ADR panel: a Session-header button that opens a frame-wide
 *   overlay showing a project's decision corpus and its compiled specs as a
 *   readable, cross-linked view. It is a VIEWER: the ratchet CLI (`ratchet verify`)
 *   remains the authority on what is enforced, and every state it displays is derived
 *   by the ratchet itself, over the host half's read-only state route, and rendered
 *   unchanged. The panel owns no derivation: force, consent matching and the ratify
 *   queue are the ratchet's `ratchetDecisions` service, whose `needsHuman` set is
 *   rendered as the window's entry point, and a page that cannot reach it says the
 *   state is unavailable rather than reading the corpus itself.
 *
 *   It offers exactly one action, and it takes it through the HOST half's consent
 *   route rather than through the Conversation. Approving or declining a decision makes
 *   the panel ask the ratchet for its own question about that decision's exact text,
 *   render that question — the record's own bytes and the two labels the ratchet put on
 *   it — and send back the label the human selected, paired with the question it came
 *   from. The host hands both to the ratchet's own `ratify` operation, which writes the
 *   approval ADR and its transcript. No chat message is composed, no model turn happens
 *   and no agent is in the loop: the human's click IS the consent. The panel never mints
 *   one and never composes an answer — every label it sends is one the ratchet's own
 *   question offered.
 *
 * INPUTS
 *   Loaded by the Web client's module loader as `@cc/dsh-adr-panel/client`. The three
 *   registrations receive the standard slot props of their scope — the Session-header
 *   action seat supplies `sessionId`; the frame-wide overlay seat supplies only
 *   root-scope props; the composer seat supplies `pendingInteraction`, the Session's
 *   effective interaction awaiting the user — plus the members returned by each
 *   registration's `inject` factory. Decision and spec text arrives in the ratchet's
 *   view model over the host half's state route; the panel reads no file.
 *
 *   THE STATE ROUTE IS LEARNED AT MOUNT TIME, from the index global the host half
 *   writes: `globalThis.__DSH_ADR_PANEL_STATE__` carries the read-only route path and
 *   this activation's capability token. It is the panel's ONLY data path, and the
 *   ratchet's `ratchetDecisions` service is the only thing that derives what it returns.
 *   A missing global is reported as state unavailable, never worked around. The answer is
 *   CAPPED by the host, and when it is, the view carries a `truncated` member naming what
 *   was cut; the window turns the corpus-wide cuts into a visible note and the
 *   `needsHuman` cut into a visible line inside the Needs-a-human section, so a partial
 *   answer is stated rather than rendered as the whole corpus.
 *
 *   THE CONSENT ROUTE IS LEARNED AT MOUNT TIME, from the index global the host half
 *   writes: `globalThis.__DSH_ADR_PANEL_CONSENT__` carries the route path and the same
 *   per-activation capability token. The token is minted in the host process's memory,
 *   never written to a file and never logged, so no tool can read it; without the global
 *   the row falls back to naming the CLI command instead of offering a button. The
 *   request is an ordinary same-origin `fetch`, which carries the harness's
 *   browser-session cookie, and the host refuses anything that fails that fence or the
 *   token.
 *
 *   PROJECT-AGNOSTIC: the node that renders is discovered by the ratchet from the
 *   project itself, not hardcoded. The view model carries the resolved `decisionsDir`,
 *   `specsDir` and project name, and the panel renders them. No zone name, law-id
 *   shape, file name beyond the generated document's suffix, or presence of any record
 *   is assumed.
 *
 *   DIAGNOSTIC: the window header carries this bundle's own `PANEL_VERSION`. A browser
 *   keeps its revision-addressed client bundle until the page reloads, so without a
 *   version a stale bundle and a bug look identical.
 *
 * OUTPUTS
 *   One contribution to each of `conversation.session.header.actions`,
 *   `shell.overlay` and `conversation.composer`. The overlay renders nothing while
 *   closed and never mutates a
 *   file. Two record kinds are rendered separately: Decisions (`type !== "approval"`)
 *   and Consents (`type === "approval"`).
 *
 *   THE WINDOW IS FOUR PARTS, NOT ONE SCROLL. A sticky section navigator sits at the top
 *   of the body and offers one tab per part — `Needs a human (N)`, `Decisions (N)`,
 *   `Consents (N)`, `Specs (N)` — each stating its count, and exactly one part's body is
 *   drawn at a time. The active part is component state; until a human chooses one it is
 *   the first non-empty part in that order (so the actionable part leads when it has
 *   anything in it), falling back to Decisions. Each part carries its own heading and a
 *   one-line explanation. The four parts still hold everything the old single column
 *   held; nothing is hidden, only put behind a tab. The ratification question the
 *   composer seat mirrored is the exception: it is drawn above the navigator whenever it
 *   is pending, because a question waiting on the human must not be behind a tab.
 *
 *   The **Needs a human** part is built from the ratchet's own `needsHuman` set — the one
 *   entry point for consents waiting, contradictions, duplicates, stale specs and a red
 *   gate — and shows a clear empty state when that set is empty, never hiding the part.
 *   The same set arrives grouped as before: decision-shaped kinds stay individual cards
 *   and every other kind is one collapsible batch, with the same order, the same hash
 *   shortening, the same stated truncation and the same way into the record it concerns.
 *
 *   A **consent** need is ACTED ON where it is: its card carries the same Approve and
 *   Decline the Decisions row carries, and the `Open` redirect is gone from it — the human
 *   used to switch tab, find the record and expand it to do the one thing the card is
 *   about. Every other kind keeps its way in, because reading the record is the only thing
 *   to do with a contradiction or a blocked record, and the Decisions row keeps its own
 *   affordance as the fallback for a consent whose need the host's cap cut from the set.
 *
 *   THE SECTION IS GROUPED BY KIND, because seven stale specs are seven copies of one
 *   shape while a consent, a contradiction and a duplicate are each a distinct act. The
 *   decision-shaped kinds (`consent`, `contradiction`, `duplicate`) stay individual
 *   cards with the ratchet's own `reason` and `action`; every other kind is one
 *   collapsible batch card — `Stale specs · 7` — whose header always states the batch
 *   name, its count and what the batch is, and whose default-collapsed body expands to
 *   each document with its path, a one-line reason, the drafted note path and the
 *   ratchet's full action. The order is fixed: consents, contradictions, duplicates, the
 *   grouped batches, then the red-gate fact, which is one card. Hash values inside a
 *   reason are shortened for display and the full text stays in the element's `title`, so
 *   what is shortened is never what is hidden. When the host's own `needsHuman` cap cut
 *   the set, the section states the shown and total counts and every kind that lost an
 *   entry, so a truncated batch reads as partial rather than complete. Every entry still
 *   offers a way into the record it concerns through the row selection the record list
 *   already uses, and that way in also switches the navigator to Decisions so the row is
 *   actually drawn. The panel copies the set unchanged and never grows a finding of its own.
 *   RATCHET computes it: the view model carries each record's `state` and `provenance`
 *   from the same `resolveActiveSet` derivation the gate uses, so a consent, a zone's
 *   authority and a supersession are never re-judged here. The panel renders
 *   `state`/`provenance` unchanged and keeps no copy of the rule. HOW a record entered
 *   force is the separate provenance pill the ratchet sends — `ratified by <id>` (a link
 *   to the consent, success tone), `agent-activated` (warn tone) or `human-authored`
 *   (business tone). `awaiting a human`, `superseded by <id>`, `rejected` and
 *   `withdrawn` are states with no provenance pill. A state the ratchet computed from
 *   another record is rendered dashed/italic (`state.derived`).
 *
 *   A DECISION ROW'S COLLAPSED PREVIEW IS ONE LINE PER FACT: the id, the title, the state
 *   pill, the provenance pill and the author pill, then a single-line summary clipped with
 *   an ellipsis. The metadata grid, the laws the record decided and the four body sections
 *   are drawn only when the row is expanded. The summary is the one derivation the panel
 *   makes here, and it is display only: `decisionSummary` strips a leading list or ordered
 *   marker and markdown emphasis, takes the first sentence that actually contains a
 *   letter, tries Decision then Context then the body's first paragraph then the title,
 *   and caps the result. A Decision written as a numbered list beginning
 *   `1. **The fiction is adopted…**` therefore reads `The fiction is adopted…`, never the
 *   bare marker `1.`.
 *
 *   A SPEC LAW IS A COMPACT ROW TOO: collapsed it shows the law id, a clipped statement,
 *   one toned chip per check KIND with its count, and the `decided in` chip; expanded it
 *   shows the full statement, the authority, every check with its type and
 *   target/pattern, and — parsed from the generated document's own `- checks: none, and
 *   this law says why:` or `- not fully covered:` line — the reason nothing (or not
 *   everything) enforces the law. The zone grouping, the check histogram, the toned
 *   check-kind chips, the `decided in` tone and the error/derive tone rules are unchanged.
 *
 *   NO PART DRAWS AN UNBOUNDED LIST: each section, and each spec's law list, draws at most
 *   50 rows and then offers a `Show N more` control beside a `Showing X of Y` line. The
 *   host's own `truncated` fact is still stated separately, so a capped client list and a
 *   capped server answer are never confused.
 *
 *   The ratify affordance appears for a decision whose `canRatify` the view model sets
 *   true — the ratchet's own queue membership — and never for one whose zone policy
 *   could not yield a consent. The panel does not re-derive that membership.
 *   A ratifiable decision's row carries **Approve** and **Decline**, and one
 *   click records the decision: the panel asks the host route for the ratchet's own
 *   question, renders it in the row — the question, the record's own file text and both
 *   of the labels the ratchet put on it — and sends the label belonging to the button
 *   the human pressed, together with that same question. The host passes both to the
 *   ratchet, whose `ratify` writes the approval ADR plus its transcript; the row then
 *   shows what was written, or the ratchet's own reason for refusing. A decline writes
 *   nothing, by the ratchet's own rule, and the row says so. So the human's click is the
 *   consent, the ratchet asked the question it is paired with, and no message is
 *   submitted to the composer at all. When the route is unreachable — no host half
 *   mounted, no capability global, no bound Session — the row prints the CLI command
 *   instead of offering a button.
 *
 *   **A decline carries a commentary.** Pressing Decline puts a reason box in the row
 *   instead of sending at once; the human types why, or leaves it empty, and confirms.
 *   The words travel with the refusal and the ratchet records them beside it in the
 *   append-only ledger — never as an answer, and never read as one — so the next
 *   proposal is drafted against a reason rather than against silence. An approval has no
 *   commentary box: there is nothing to explain about a yes, and a reason sent with one
 *   would be discarded. An empty box is sent as no reason at all, never as an empty
 *   string, so a silent decline stays silent; the outcome then shows the recorded reason
 *   back, so the human sees the words the ratchet stored.
 *
 *   **A blocked record is pending WITH a way to resolve it.** Its card reads the ratchet's
 *   plan from a third host route, `/adr-panel/resolve`, and draws it: the steps, whether
 *   any needs a human, and the reasons a human already declined. **Resolve** QUEUES the
 *   record — it dispatches nothing — and **closing the window** sends every queued id in
 *   ONE request, because a resolver edits the project's manifest and one per click is one
 *   surviving edit and five lost ones. The window states the queue while it is still open.
 *   **Decline with a reason** records why the proposed resolution is wrong, so the next
 *   attempt can differ. A plan with a step no agent may carry renders Resolve disabled and
 *   says so, because a child started there could not finish. Starting a resolver mints
 *   nothing: the child writes a `proposed` record and the human still approves it through
 *   the row's own Approve. When the route is unreachable the card names the CLI command.
 *
 *   The composer entry claims the seat only for a question whose intent is the ratchet's
 *   `ratify-decision`, whose answers are exactly the two options that intent names, and
 *   which names the record it is about (`intent.targetId`) — a question whose record the
 *   panel cannot identify is never answered on the human's behalf. It renders a POINTER
 *   there and never the question, its detail or either answer label, so an agent's
 *   decision never becomes a quiz in the Conversation. A question that arrives with no
 *   click behind it — an agent called `ratchet_ratify`, say — is shown in this window
 *   with its two labels, so it is never unanswerable. A question without that intent,
 *   which is what a grilling session asks, is not claimed at all and is answered in the
 *   Conversation. The panel cannot mint a consent: every button sends one of the labels
 *   the ratchet itself put in the question, and a consent record is not a decision and
 *   is never offered for ratification.
 *
 *   COLOUR: one `tone(kind)` helper maps a semantic kind onto the shell's state and
 *   label theme tokens (`var(--token, fallback)`, so any theme works and a missing token
 *   still renders). Every status surface — pill, row accent bar, row tint, check-kind
 *   chip and histogram segment — reads that one helper, so they cannot drift. A
 *   decision awaiting a human is the warn tone and leads the list; in-force is success,
 *   a derived in-force/ratified state is success and labelled derived, superseded is
 *   muted (never error), rejected/withdrawn is error, a consent and a human author are
 *   the business tone, and an agent author is neutral. Ordering is presentation only:
 *   awaiting-human, then in force, then everything else, each by id.
 *
 *   SHAPE OF A STATUS: the two kinds of status are drawn differently on purpose. A
 *   **state** — in force, awaiting a human, superseded, rejected, withdrawn — is a
 *   FILLED pill, because it describes where the record stands and, when it awaits a
 *   human, is the call to action. **Provenance** — how an in-force record got there:
 *   `ratified by <ids>`, `agent-activated`, `human-authored` — is an OUTLINED pill
 *   (transparent background, coloured border and text, same tone), because it informs
 *   rather than acts. A record `type` such as `consent` is filled. A state derived from
 *   another record keeps its dashed/italic treatment. The legend groups the three
 *   families under muted labels (`state`, `in force by`, `record`) so the distinction
 *   is legible without reading every row, and draws each group in the shape its pills
 *   use elsewhere — the `in force by` group is outlined, the other two filled.
 *
 *   A FILL IS A TINT: a pill's background comes from a `-tertiary` token or the shell's
 *   danger surface, never a `-secondary` or `-primary`, because those name solid variants
 *   whose value can equal the text colour — in the dark theme the error pair is literally
 *   the same red, which painted the label invisible. The error tone is the one kind the
 *   shell defines no `-tertiary` for, so it borrows `interactive-bg-hover-danger`, the red
 *   surface the shell's own components pair with `state-error-primary`.
 *
 *   A law card's `decided in <id>` chip takes the tone of the decision it names, not a
 *   fixed neutral: a law decided by a superseded or unknown decision must not read like
 *   an enforced one. The chip is the tone of that decision's state when the decision is
 *   in the corpus, and neutral when it is not.
 *
 *   THE WINDOW'S TEXT IS THE READER'S, NOT THE PARSER'S: section headings are the plain
 *   names (`Decisions`, `Consents`, `Specs`) with the resolved directory on a muted
 *   second line, not the glob pattern they were listed with; the header summary lists
 *   only non-zero counts and renders the awaiting-for-a-human count as its own warn
 *   pill; and an author label collapses to one word when the name and the authority are
 *   the same (`human`, never `human · human`).
 *
 * KEYWORDS
 *   ADR panel, decisions, consents, specs, law cards, check histogram, section navigation,
 *   tabs, sticky nav, one section at a time, collapsed preview, one-line summary, summary
 *   extraction, list marker, ordered list, bounded render, row cap, show more,
 *   shell.overlay, session header, conversation.composer, composer seat claim,
 *   presentation intent, state route, ratchetDecisions, view model, capability token,
 *   ratification, approve, decline, decline reason, commentary, consent route, resolve
 *   route, blocked decision, resolver, resolve plan, subagent, queue, batch, dispatch on
 *   close, steer, not now, read-only, viewer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The state route unreachable — no host half mounted, no state capability, no bound
 *     Session, or a refusal: the window SAYS the state is unavailable, with the reason,
 *     and never falls back to reading the corpus or deriving force itself.
 *   - The consent route unreachable — no host half mounted, no capability global, or no
 *     Session bound: the row names the CLI command instead of the two buttons, and
 *     nothing is sent anywhere.
 *   - A decision the ratchet's queue does not list — already in force, retired, a zone
 *     that is `humanOnly` or undeclared, or an id that is not a decision at all: the ask
 *     returns the ratchet's own message, the row shows it, and nothing is written. The
 *     ratchet is the authority on what may be ratified; the row's affordance is the
 *     ratchet's own `canRatify`, rendered as it arrives.
 *   - A question the panel cannot reduce to two labelled answers (`ratifyQuestionOf`
 *     returns `null` for the returned quiz): the row says it cannot put the question, and
 *     no label is sent.
 *   - The round trip's outcome is always shown: an approval names the approval id, its
 *     file and the transcript; a decline says the decision stays proposed and that
 *     nothing was written, and repeats the reason it recorded when there was one; a
 *     refusal shows the ratchet's own problem codes and messages; a transport failure
 *     shows the failure's message. No outcome leaves the row silent.
 *   - A decline the human cancels, or one whose reason is only whitespace: the cancel
 *     returns to the two buttons and sends nothing, and the whitespace is sent as no
 *     reason, so neither leaves a half-recorded refusal behind.
 *   - The resolve route unreachable, or a composition with no subagent runtime: the blocked
 *     card names the CLI command rather than offering a button that could not work, and a
 *     plan that needs a human disables Resolve instead of queueing a doomed child. A
 *     dispatch the host refuses — no live Session, no runtime, a failed start, a resolver
 *     already working in another Session — happens as the window closes, so it lands as the
 *     absence of a new resolver Session rather than as a line here; the queue bar tells the
 *     human what will run before they close.
 *   - A close with an empty queue: nothing is sent at all, so opening the window to read and
 *     closing it again starts no model turn.
 *   - A click INSIDE the window: it never reaches the backdrop's close handler. The backdrop
 *     closes on click, and a click on any control bubbles to it, so the window stops BOTH
 *     `onMouseDown` and `onClick`; stopping only the former is what made pressing Resolve
 *     close the panel. The close is also guarded, because state updates are asynchronous and
 *     a second close in the same render would still see the old queue and send the batch
 *     twice.
 *   - A record edited between the ask and the answer: the ratchet refuses with
 *     `RATIFICATION_STALE` and writes nothing, which is what binds the consent to the
 *     text the human was shown rather than to whatever is on disk when the answer lands.
 *   - A second click while a round trip is in flight: the buttons are disabled, because
 *     two answers to one question would settle it twice.
 *   - A question naming a record no click asked about: it is NOT answered, and this window
 *     offers it with both labels instead, so the panel never answers for the human.
 *   - The same pending interaction is never settled twice: the decision is recorded
 *     against the interaction, because the harness throws when one pending question is
 *     settled twice and a render can run an effect more than once.
 *   - A request names its record EXACTLY. A prefix, a suffix or stray whitespace is a
 *     different record and answers nothing.
 *   - A pending question that is not the ratchet's, or is the ratchet's but not a
 *     claimable shape (several questions, no detail, multi-select, not exactly two
 *     labelled options, no option carrying the intent's approve label, no callable
 *     `answer`), or is a grilling session's question, which carries no panel intent:
 *     the composer seat falls through to the harness's own question card, so the human
 *     still gets a presentation that can send every answer — including free text, which
 *     the ratchet reports unreadable and re-asks. That fall-through is also the fallback
 *     when this bundle is not loaded at all, so a claim can never make a question
 *     unanswerable.
 *   - The panel window closed while a ratification question is open: the Conversation
 *     keeps the pointer, whose button reopens the window on the same interaction, so the
 *     question is stranded neither in a closed window nor in a chat card.
 *   - The panel window not open when a question arrives, or opened after it: the window
 *     renders from the mirrored interaction, so it shows the question whatever the order.
 *     It is re-tested with `ratifyQuestionOf` before a button is offered, and the window
 *     never renders the question in the Conversation at all.
 *   - A click on an answer that the harness refuses to settle (the question settled in
 *     another surface, or its transport ended): the failure's message is shown and the
 *     buttons re-enable; the click never throws out of the handler.
 *   - A record the ratchet's view reports without display text — an unreadable file:
 *     the row still lists the ratchet's state facts, and its body renders empty rather
 *     than being reported as unpaid or unverified by a local hash the panel never made.
 *   - A spec document whose generated text does not parse: the spec card is listed with
 *     whatever parsed and a note; a field that did not parse renders as `unknown`, and
 *     parsing never throws.
 *   - A `decided in <id>` that names no decision in the corpus, or one whose state is
 *     not `in force`: the chip is rendered as plain text, is not clickable, and takes
 *     the neutral tone (unknown id) or the named decision's own state tone.
 *   - An author whose name and authority are the same word: the label collapses to that
 *     one word.
 *   - A section with nothing to show: a clean line naming the resolved directory, never
 *     a crash, and the header summary omits its zero count.
 *   - Window closed during a load: the AbortController cancels the state request and no
 *     state is written after unmount. A consent round trip already in flight is not
 *     cancelled; the ratchet either records it or not, and the row's next render
 *     reflects that.
 *   - A project whose view reports problems — no manifest, an unparseable one, a
 *     disabled ratchet, a corpus that does not parse: the problems are shown as notes,
 *     and the state the ratchet could still derive is rendered.
 *   - A project with no decision files or no specs (or no such directory): a clean empty
 *     line that names the resolved directory, never a crash.
 *   - The spec histogram counts fewer checks than the document declares: a warn line says
 *     so, because a parse gap must not render as an unlabelled segment.
 *   - A check whose parsed type is empty: its type pill renders `unknown` in the neutral
 *     tone, so a check row can never be a detail with no label.
 *   - A needs-human kind the window has never seen: it is grouped under its own name with
 *     hyphens turned into spaces and its entries are reachable by expanding it, so a new
 *     kind is shown rather than dropped.
 *   - A needs-human set the host's cap cut: the section says the shown and total counts and
 *     names every kind that lost an entry, and a cut batch's header reads `shown of total`.
 *   - A reason, action, problem line or spec header carrying a full `sha256:<64 hex>`: it
 *     renders shortened (twelve hex and an ellipsis) with the full value in the element's
 *     `title`, so nothing is hidden and no visible node shows a raw 64-hex value.
 *   - A Decision section written as a numbered list (`1. **…**`): the leading marker and
 *     the emphasis are stripped before the first sentence is taken, so the summary is the
 *     first sentence and never the bare marker `1.`. A Decision that is ONLY a marker, or
 *     that has no letter at all, falls through to Context, then to the first body
 *     paragraph, then to the title; if every candidate is unreadable the row renders no
 *     summary line rather than a number or punctuation.
 *   - A generated law with an `unenforced` note (`- checks: none, and this law says why:`
 *     or `- not fully covered:`): the reason is parsed and shown in the expanded law row;
 *     a law whose note cannot be parsed simply renders no note rather than a claim.
 *   - A corpus larger than 50 rows in one part: the part draws the first 50 and shows a
 *     `Show N more` control beside `Showing X of Y`; the rows past the cap are loaded and
 *     revealed by the control, never dropped, and the host's own truncation is stated
 *     separately.
 */
window.__ModuleLoader__.load({
	id: "@cc/dsh-adr-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		/**
		 * The panel's own version, rendered as a muted chip in the window header.
		 *
		 * A browser keeps its revision-addressed client bundle until the page reloads, so
		 * an installed update can be invisible while the previous bundle stays live. This
		 * constant is the only way to tell a stale bundle from a bug: bump it with every
		 * change to this file, one patch above the package's current version. The repack
		 * step (`scripts/pack-plugin.mjs`) then bumps `package.json` to match, so the two
		 * are equal again after a release and the constant is one ahead only in the working
		 * tree between a source edit and the pack.
		 */
		const PANEL_VERSION = "0.1.47";
		/** Directories used when the host view reports none. */
		const DEFAULT_DECISIONS_DIR = "docs/adrs";
		const DEFAULT_SPECS_DIR = "docs/specs";
		/**
		 * How many rows one section draws before it offers a "show more" control.
		 *
		 * The host already caps what it sends (500 records, 200 needs-a-human entries), and
		 * a 500-row list is still a 500-row DOM: every row a browser builds is a node, and a
		 * window that renders the whole capped answer is slow for exactly the corpus that
		 * most needs the window. This is a CLIENT-side bound on drawing, not on data: the
		 * rows beyond it are still in the loaded view and are revealed by the control
		 * together with a stated count, so a bounded list is never mistaken for a short one.
		 */
		const SECTION_ROW_CAP = 50;
		/** The longest one-line decision summary, matching the row that renders it. */
		const SUMMARY_LIMIT = 140;
		/** The longest one-line law statement in a collapsed spec row. */
		const STATEMENT_LIMIT = 120;
		/**
		 * The channels a ratification can have been obtained through.
		 *
		 * Duplicated from the ratchet's `RATIFICATION_CHANNELS` because this bundle cannot
		 * import the ratchet's module. The consent path no longer compares a channel itself
		 * — the ratchet's `ratchetConsent` service owns that match now — but the value is
		 * still the shared wire vocabulary of the consent surface, and
		 * `scripts/check-consent-surface.mjs` fails when the two lists stop being equal, so
		 * neither half can silently stop naming a channel the other can mint.
		 */
		const RATIFICATION_CHANNELS = ["user-question", "adr-panel"];
		/**
		 * The `intent.kind` the ratchet puts on its ratification questions.
		 *
		 * A question may carry `intent: { kind, approve }` to say how it wants to be
		 * presented. The harness renders a kind it knows itself, and a presentation that
		 * claims the composer seat may recognise any kind at all: the seat is a chain, the
		 * first registered entry whose `select` returns a value wins, and the entries are
		 * tried in registration order. The value may not be swapped for a structural
		 * guess: two buttons can express the two answers this intent declares, and an
		 * intent the panel does not recognise must fall through to the harness's own
		 * question card, which is the only presentation that offers a free-text answer.
		 *
		 * The literal is DUPLICATED, deliberately, and cannot be imported: the ratchet is
		 * a Node plugin and this file is a hand-written browser closure with no module
		 * graph, so `RATIFY_INTENT_KIND` in the ratchet source and this constant are two
		 * copies of one wire value. `scripts/check-consent-surface.mjs` fails when they
		 * stop being equal, which is the only thing that keeps the copies honest.
		 */
		const RATIFY_INTENT_KIND = "ratify-decision";
		/**
		 * The host half's consent route, and the two names its capability travels under.
		 *
		 * The path is a literal for the same reason as `RATIFY_INTENT_KIND`: the host half
		 * is a Node module and this is a browser closure, so the value exists twice and
		 * `scripts/check-consent-surface.mjs` fails when the copies stop being equal. The
		 * ROUTE ITSELF is not what authorizes a request, though — the token is — and the
		 * route is only read from the global below, so a bundle whose literal drifted
		 * cannot call a host that moved: it finds no capability and falls back to naming
		 * the CLI command.
		 *
		 * `CONSENT_GLOBAL` is the index global the host half writes:
		 * `{ route, token }`, with a token minted in the host process's memory per
		 * activation, never written to a file and never logged. That is what makes the
		 * route unreachable by an agent rather than merely unofficial: there is no file,
		 * no tool result and no CLI argument that carries it, and the host additionally
		 * refuses any request that fails the harness's browser-session fence.
		 */
		const CONSENT_ROUTE = "/adr-panel/consent";
		const CONSENT_HEADER = "x-adr-panel-consent";
		const CONSENT_GLOBAL = "__DSH_ADR_PANEL_CONSENT__";
		/**
		 * The host half's read-only state route, and the two names its capability travels
		 * under.
		 *
		 * The window renders ONLY what this route returns. It carries no derivation of its
		 * own: force, consent matching and the ratify queue are computed by the ratchet's
		 * `ratchetDecisions` service, and the panel's job is to draw that. The literals are
		 * duplicated for the same reason as the consent route's, and
		 * `scripts/check-consent-surface.mjs` fails when the two halves stop agreeing. A
		 * page whose host half is absent, older, or composed without a web server has no
		 * global, and the window then says the state is unavailable — it never falls back
		 * to reading the corpus itself, because a second derivation is the defect this
		 * route removes.
		 */
		const STATE_ROUTE = "/adr-panel/state";
		const STATE_HEADER = "x-adr-panel-state";
		const STATE_GLOBAL = "__DSH_ADR_PANEL_STATE__";
		/**
		 * The host half's resolve route, and the two names its capability travels under.
		 *
		 * A blocked decision's card reads the ratchet's plan from here and, from it, asks for
		 * a resolver or records a reason for refusing one. The plan, the steps and the
		 * resolver prompt are the ratchet's text, never this bundle's: the panel draws what
		 * the route returns and sends one of two `decision` values. The literals are
		 * duplicated for the same reason as the other two routes', and
		 * `scripts/check-consent-surface.mjs` fails when the halves stop agreeing. Starting
		 * a resolver is the one thing this panel does that is not a consent; it still mints
		 * nothing, because the child writes a `proposed` record and a human ratifies it.
		 */
		const RESOLVE_ROUTE = "/adr-panel/resolve";
		const RESOLVE_HEADER = "x-adr-panel-resolve";
		const RESOLVE_GLOBAL = "__DSH_ADR_PANEL_RESOLVE__";
		/** The page origin the routes are fetched from; the corpus and the routes share it. */
		const CONSENT_ORIGIN_FALLBACK = "http://dsh.internal";

		//#region panel store
		/**
		 * The panel's shared view state. It is not harness state: it holds only
		 * whether the window is open, which Session it was opened from, and the pending
		 * ratification question the composer entry claims.
		 *
		 * `ratify` is a crossing on purpose: the ratification question is published by the
		 * harness as a Session-scoped pending interaction, and only the composer seat
		 * receives it as a slot prop. The overlay is a different seat and cannot read that
		 * prop, so the entry that receives it hands the interaction here and the window
		 * renders it with the ratchet's own two labels. A row's Approve or Decline does NOT
		 * travel this way: it goes to the host route directly, which is what removes the
		 * chat message from the flow.
		 * @returns a bare getSnapshot/subscribe source the renderer binds into a hook.
		 */
		function createPanelStore() {
			var state = { open: false, sessionId: null, ratify: null };
			var listeners = new Set();
			return {
				getSnapshot: function () {
					return state;
				},
				subscribe: function (listener) {
					listeners.add(listener);
					return function () {
						listeners.delete(listener);
					};
				},
				set: function (patch) {
					state = Object.assign({}, state, patch);
					listeners.forEach(function (listener) {
						try {
							listener();
						} catch (error) {
							// A subscriber must not be able to break the store for the others.
						}
					});
				}
			};
		}
		//#endregion

		/**
		 * The interactions the composer entry has already settled while claiming the seat.
		 *
		 * A render can run an effect more than once (a strict-mode double invoke, a
		 * re-mount), and the harness THROWS when one pending question is settled twice, so
		 * the decision is recorded against the interaction itself rather than against a
		 * render. A WeakSet holds the interaction without keeping it alive. It is used only
		 * by the window's own answer buttons for a question the ratchet asked through ANOTHER
		 * path (an agent calling `ratchet_ratify`); the row's Approve and Decline do not
		 * settle an interaction at all.
		 */
		const autoSettled = new WeakSet();

		//#region consent route
		/**
		 * The capability the host half published into this page, or `null`.
		 *
		 * The host half writes an index global carrying the route path and a token it
		 * minted in the host process's memory for this activation. The token is the
		 * authorization, not the path: it is in no file and in no tool result, so an agent
		 * cannot obtain it, and the host refuses a request without it. A page whose host
		 * half is absent, older, or composed without a web server simply has no global, and
		 * the row falls back to naming the CLI command rather than offering a button that
		 * could not work.
		 *
		 * @returns `{ route, token }` when both are non-empty strings, otherwise `null`.
		 */
		function consentEndpoint() {
			if (typeof globalThis === "undefined") return null;
			var bridge = globalThis[CONSENT_GLOBAL];
			if (bridge === null || typeof bridge !== "object") return null;
			if (typeof bridge.route !== "string" || bridge.route === "") return null;
			if (typeof bridge.token !== "string" || bridge.token === "") return null;
			return { route: bridge.route, token: bridge.token };
		}
		/**
		 * The state route capability the host half published into this page, or `null`.
		 *
		 * Same shape, same per-activation token as {@link consentEndpoint}, a different
		 * global and route. Without it the window shows that state is unavailable rather
		 * than reading the corpus itself: the host half is the only thing that owns the
		 * ratchet's derivation, and a page that cannot reach it has no state to show.
		 *
		 * @returns `{ route, token }` when both are non-empty strings, otherwise `null`.
		 */
		function stateEndpoint() {
			if (typeof globalThis === "undefined") return null;
			var bridge = globalThis[STATE_GLOBAL];
			if (bridge === null || typeof bridge !== "object") return null;
			if (typeof bridge.route !== "string" || bridge.route === "") return null;
			if (typeof bridge.token !== "string" || bridge.token === "") return null;
			return { route: bridge.route, token: bridge.token };
		}
		/**
		 * The resolve route capability the host half published into this page, or `null`.
		 *
		 * Same shape and the same per-activation token as the other two routes, a different
		 * global and route. Without it a blocked card renders its plan read-only and names the
		 * CLI command instead of offering Resolve or Decline: a card that could not reach the
		 * route must not look like one that can.
		 *
		 * @returns `{ route, token }` when both are non-empty strings, otherwise `null`.
		 */
		function resolveEndpoint() {
			if (typeof globalThis === "undefined") return null;
			var bridge = globalThis[RESOLVE_GLOBAL];
			if (bridge === null || typeof bridge !== "object") return null;
			if (typeof bridge.route !== "string" || bridge.route === "") return null;
			if (typeof bridge.token !== "string" || bridge.token === "") return null;
			return { route: bridge.route, token: bridge.token };
		}
		/**
		 * The page origin the consent route is reached on.
		 *
		 * The corpus and the route are served by the same host, so the panel fetches its own
		 * origin. A shell that loads the client over `file://` reports the origin `null`,
		 * which is not fetchable; the fallback is a name that resolves nowhere and produces
		 * a transport failure the row reports, rather than a silent success.
		 * @returns The origin string.
		 */
		function consentOrigin() {
			var origin = typeof globalThis !== "undefined" && globalThis.location !== undefined && globalThis.location !== null ? globalThis.location.origin : undefined;
			return typeof origin === "string" && origin !== "" && origin !== "null" ? origin : CONSENT_ORIGIN_FALLBACK;
		}
		/**
		 * Performs one consent request and reads its JSON body.
		 *
		 * The capability header is what authorizes the call; the browser adds its
		 * browser-session cookie itself, and the host checks both. A body that is not JSON
		 * is reported as such rather than thrown, because a refusal is exactly what the
		 * caller must render.
		 *
		 * @param path - Route path plus query string.
		 * @param init - A `fetch` init.
		 * @returns A promise of `{ status, body }`; the body is `null` when it did not parse.
		 */
		function consentRequest(path, init) {
			var doFetch = typeof globalThis !== "undefined" ? globalThis.fetch : undefined;
			if (typeof doFetch !== "function") {
				return Promise.reject(new Error("this browser has no fetch, so the ADR panel cannot reach its host route"));
			}
			return doFetch(consentOrigin() + path, init).then(function (response) {
				return response.json().then(
					function (body) { return { status: response.status, body: body }; },
					function () { return { status: response.status, body: null }; }
				);
			});
		}
		/**
		 * PURPOSE
		 *   Ask the host for the ratchet's own question about one decision. It writes
		 *   nothing: the question exists, and the human has not answered yet.
		 *
		 * INPUTS
		 *   adrId — the decision id the human pressed a button on (a non-empty string).
		 *   sessionId — the Session the window was opened from; the host resolves the
		 *   project root from it and refuses an unknown Session.
		 *
		 * OUTPUTS
		 *   A promise of `{ ok, quiz, pending, blocked, problems, message, error }` — the
		 *   ratchet's own result, plus `error` when the transport or the host refused.
		 *   `quiz` is present exactly when there is a question to render. A transport
		 *   failure resolves to `{ ok: false, error }` rather than rejecting, so a click
		 *   never throws and the row always has something to show.
		 *
		 * KEYWORDS
		 *   consent route, ask, ratification question, capability token, no write
		 */
		function askConsent(adrId, sessionId) {
			var endpoint = consentEndpoint();
			if (endpoint === null) return Promise.resolve({ ok: false, error: "unreachable" });
			if (typeof adrId !== "string" || adrId === "") return Promise.resolve({ ok: false, error: "no-decision" });
			if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no-session" });
			var init = { method: "GET", headers: {} };
			init.headers[CONSENT_HEADER] = endpoint.token;
			return consentRequest(endpoint.route + "?session=" + encodeURIComponent(sessionId) + "&id=" + encodeURIComponent(adrId), init).then(
				function (answer) {
					if (answer.status !== 200 || answer.body === null) {
						return { ok: false, error: "refused", status: answer.status, message: answer.body === null ? "the host answered with no readable body" : answer.body.message };
					}
					return answer.body;
				},
				function (error) { return { ok: false, error: describeError(error) }; }
			);
		}
		/**
		 * PURPOSE
		 *   Hand the host the label the human selected, paired with the question it came
		 *   from, and return the ratchet's verdict. The label must be one the question
		 *   itself offered; this function never invents one.
		 *
		 * INPUTS
		 *   adrId — the decision id (a non-empty string).
		 *   label — the exact string the question offered for the button the human pressed.
		 *   quiz — the question object `askConsent` returned, UNCHANGED. It is sent back so
		 *   the ratchet can rebuild its own question and refuse an answer that is not paired
		 *   with one it built; without it the host refuses and mints nothing.
		 *   sessionId — the Session the window was opened from.
		 *   comment — the human's reason for declining, or `null`/an empty string when they
		 *   gave none. It travels with the answer and is recorded only beside a REFUSAL: the
		 *   ratchet ignores it for an approval, and this function sends no reason at all when
		 *   the human typed none, so an empty box is `null` rather than an empty string.
		 *
		 * OUTPUTS
		 *   A promise of the ratchet's own result plus `error` on a transport or host
		 *   refusal: `{ ok, ratified, rejected, unreadable, approval, transcript, wrote,
		 *   problems, error }`. Never rejects.
		 *
		 * KEYWORDS
		 *   consent route, settle, label, paired quiz, approval, transcript, decline reason
		 */
		function settleConsent(adrId, label, quiz, sessionId, comment) {
			var endpoint = consentEndpoint();
			if (endpoint === null) return Promise.resolve({ ok: false, error: "unreachable" });
			if (typeof adrId !== "string" || adrId === "") return Promise.resolve({ ok: false, error: "no-decision" });
			if (typeof label !== "string" || label === "") return Promise.resolve({ ok: false, error: "no-label" });
			if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no-session" });
			var reason = typeof comment === "string" && comment.trim() !== "" ? comment : null;
			var init = {
				method: "POST",
				headers: {},
				body: JSON.stringify({
					session: sessionId,
					adrId: adrId,
					label: label,
					// The question travels back byte for byte, because the ratchet refuses an
					// answer that is not paired with the question it built. `null` when there is
					// none is deliberate: it is the payload that must mint nothing.
					quiz: quiz === undefined ? null : quiz,
					// The human's own words, sent UNREAD. The panel attaches no meaning to them
					// and the ratchet records them without letting them answer anything, so a
					// reason can never become a consent.
					comment: reason
				})
			};
			init.headers[CONSENT_HEADER] = endpoint.token;
			init.headers["content-type"] = "application/json";
			return consentRequest(endpoint.route, init).then(
				function (answer) {
					if (answer.status !== 200 || answer.body === null) {
						return { ok: false, error: "refused", status: answer.status, message: answer.body === null ? "the host answered with no readable body" : answer.body.message };
					}
					return answer.body;
				},
				function (error) { return { ok: false, error: describeError(error) }; }
			);
		}
		/**
		 * PURPOSE
		 *   Ask the host for the ratchet's resolve plan for one blocked decision: the steps
		 *   that would unblock it, whether any needs a human, and the reasons a human already
		 *   declined a resolution. It starts nothing and writes nothing.
		 *
		 * INPUTS
		 *   adrId — the blocked decision id (a non-empty string).
		 *   sessionId — the Session the window was opened from.
		 *
		 * OUTPUTS
		 *   A promise of the ratchet's own plan `{ ok, id, title, path, steps, humanRequired,
		 *   declined, reason }` plus `error` when the transport or the host refused. Never
		 *   rejects.
		 *
		 * KEYWORDS
		 *   resolve route, plan, steps, human required, declined reasons, read only
		 */
		function askPlan(adrId, sessionId) {
			var endpoint = resolveEndpoint();
			if (endpoint === null) return Promise.resolve({ ok: false, error: "unreachable" });
			if (typeof adrId !== "string" || adrId === "") return Promise.resolve({ ok: false, error: "no-decision" });
			if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no-session" });
			var init = { method: "GET", headers: {} };
			init.headers[RESOLVE_HEADER] = endpoint.token;
			return consentRequest(endpoint.route + "?session=" + encodeURIComponent(sessionId) + "&id=" + encodeURIComponent(adrId), init).then(
				function (answer) {
					if (answer.status !== 200 || answer.body === null) {
						return { ok: false, error: "refused", status: answer.status, message: answer.body === null ? "the host answered with no readable body" : answer.body.message };
					}
					return answer.body;
				},
				function (error) { return { ok: false, error: describeError(error) }; }
			);
		}
		/**
		 * PURPOSE
		 *   Send ONE resolve or decline request for a blocked decision to the host route.
		 *   `resolve` asks for a resolver child; `decline` records a refusal with the human's
		 *   reason. Neither is a consent: an approval is a separate act through the consent
		 *   route, and nothing here can mint one.
		 *
		 * INPUTS
		 *   adrId — the blocked decision id (a non-empty string).
		 *   sessionId — the Session the window was opened from.
		 *   decision — `"resolve"` or `"decline"`; anything else is refused here, before any
		 *   request is made, so a typo cannot be sent as one of the two.
		 *   comment — the human's reason, meaningful only on a decline and sent as `null`
		 *   when empty, so a silent refusal stays silent.
		 *
		 * OUTPUTS
		 *   A promise of the host's own result plus `error` on a transport or host refusal:
		 *   `{ ok, spawned, steps, declined, recorded, comment, humanRequired, message,
		 *   error }`. Never rejects.
		 *
		 * KEYWORDS
		 *   resolve route, start resolver, decline, reason, spawn, no consent
		 */
		function requestResolve(adrId, sessionId, decision, comment) {
			var endpoint = resolveEndpoint();
			if (endpoint === null) return Promise.resolve({ ok: false, error: "unreachable" });
			if (typeof adrId !== "string" || adrId === "") return Promise.resolve({ ok: false, error: "no-decision" });
			if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no-session" });
			if (decision !== "resolve" && decision !== "decline") return Promise.resolve({ ok: false, error: "no-decision-kind" });
			var reason = typeof comment === "string" && comment.trim() !== "" ? comment : null;
			var init = {
				method: "POST",
				headers: {},
				body: JSON.stringify({
					session: sessionId,
					adrId: adrId,
					decision: decision,
					// The human's own words, sent UNREAD and only ever recorded beside a refusal.
					comment: decision === "decline" ? reason : null
				})
			};
			init.headers[RESOLVE_HEADER] = endpoint.token;
			init.headers["content-type"] = "application/json";
			return consentRequest(endpoint.route, init).then(
				function (answer) {
					if (answer.status !== 200 || answer.body === null) {
						return { ok: false, error: "refused", status: answer.status, message: answer.body === null ? "the host answered with no readable body" : answer.body.message };
					}
					return answer.body;
				},
				function (error) { return { ok: false, error: describeError(error) }; }
			);
		}
		/**
		 * PURPOSE
		 *   Dispatch the WHOLE queue of blocked records to one resolver. It is sent when the
		 *   window closes, not when a card is clicked: a resolver edits the project's manifest,
		 *   so six of them running at once is one surviving edit and five lost ones — the
		 *   observable failure that produced this function.
		 *
		 * INPUTS
		 *   adrIds — the record ids the human queued (a non-empty array of non-empty strings).
		 *   sessionId — the Session the window was opened from.
		 *
		 * OUTPUTS
		 *   A promise of the host's own result plus `error` on a transport or host refusal:
		 *   `{ ok, ids, spawned, steered, childId, humanRequiredIds, skipped, error }`. Never
		 *   rejects, because the window is closing and nothing is left to render a throw into.
		 *   The dispatch is deliberately not awaited by the caller for the same reason: the
		 *   request is in flight as the panel closes, and the resolver appears as its own
		 *   Session.
		 *
		 * KEYWORDS
		 *   resolve route, batch, queue, one resolver, dispatch on close
		 */
		function requestResolveBatch(adrIds, sessionId) {
			var endpoint = resolveEndpoint();
			if (endpoint === null) return Promise.resolve({ ok: false, error: "unreachable" });
			var ids = (Array.isArray(adrIds) ? adrIds : []).filter(function (entry) { return typeof entry === "string" && entry !== ""; });
			if (ids.length === 0) return Promise.resolve({ ok: false, error: "no-decision" });
			if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no-session" });
			var init = {
				method: "POST",
				headers: {},
				body: JSON.stringify({ session: sessionId, adrIds: ids, decision: "resolve" })
			};
			init.headers[RESOLVE_HEADER] = endpoint.token;
			init.headers["content-type"] = "application/json";
			return consentRequest(endpoint.route, init).then(
				function (answer) {
					if (answer.status !== 200 || answer.body === null) {
						return { ok: false, error: "refused", status: answer.status, message: answer.body === null ? "the host answered with no readable body" : answer.body.message };
					}
					return answer.body;
				},
				function (error) { return { ok: false, error: describeError(error) }; }
			);
		}
		/**
		 * Reduces a question the host returned to the same claim shape the composer seat
		 * uses for a pending interaction.
		 *
		 * The ratchet builds one question type and the panel renders it from one predicate:
		 * a quiz from the route is structurally the interaction's `questions` plus an
		 * `answer` function, and the predicate reads only the questions. Going through
		 * `ratifyQuestionOf` is what keeps the two paths from drifting — the labels the row
		 * sends are the same two labels the seat would have offered, and a question the
		 * panel cannot answer completely is refused in both places for the same reason.
		 *
		 * @param quiz - The `quiz` from an ask result, or any value.
		 * @returns A claim value, or `null` when the question is not one the panel may put.
		 */
		function claimOfQuiz(quiz) {
			if (quiz === null || typeof quiz !== "object") return null;
			return ratifyQuestionOf({ questions: quiz.questions, answer: function () {} });
		}
		//#endregion

		//#region ratification question
		/**
		 * PURPOSE
		 *   Decide whether a pending interaction is the ratchet's ratification question,
		 *   and reduce it to the two labelled answers the panel is allowed to offer. It
		 *   is the gate that keeps a claimed question honest: the panel may take over the
		 *   composer seat only for a question it can answer COMPLETELY, because a
		 *   presentation that claims a question and then cannot send one of its answers
		 *   has silently removed an option the human was owed.
		 *
		 * INPUTS
		 *   interaction — the `pendingInteraction` slot prop, or any value. Read
		 *   structurally: `questions` (array of exactly one), `questions[0].intent.kind`
		 *   (`ratify-decision`), `questions[0].detail` (present), `questions[0].multiSelect`
		 *   (not `true`), `questions[0].options` (exactly two, each with a string `label`,
		 *   one of them equal to `intent.approve`), and `answer` (a function).
		 *
		 *   `intent.targetId` (a non-empty string naming the record) is REQUIRED, because
		 *   the panel settles the question on the human's behalf from a click on that
		 *   record's row: without it the panel cannot tell which record a question is
		 *   about, and a presentation that cannot tell must not answer at all. Its own
		 *   question id is the ratchet's private naming, not a contract to parse.
		 *
		 *   It is also applied to a quiz the host route returned, wrapped as
		 *   `{ questions, answer: noop }` by `claimOfQuiz`. The ratchet builds one question
		 *   type and the panel reads it with one predicate, so the labels a row's Approve
		 *   and Decline send are the labels the composer seat would have offered, and a
		 *   question this predicate refuses is refused on both paths.
		 *
		 * OUTPUTS
		 *   `{ pending, id, targetId, header, question, detail, approve, decline }`, or
		 *   `null` when the value is not a claimable ratification question —
		 *   `null`/`undefined`, an array of zero or several questions, a missing or foreign
		 *   `intent`, a missing `intent.targetId`, an absent detail, a multi-select, a
		 *   number of options other than two, a non-string label, no option carrying
		 *   `intent.approve`, or no callable `answer`. A question with free text reachable
		 *   is still claimable: free text is not an answer this ratchet can read (it is
		 *   reported unreadable and re-asked), so the two declared options are every answer
		 *   that changes anything, and `Not now` keeps the exit the harness's own
		 *   plan-review card keeps.
		 *
		 * KEYWORDS
		 *   ratification, presentation intent, composer seat, chain select, claim guard,
		 *   binary choice, approve, decline, fallthrough
		 */
		function ratifyQuestionOf(interaction) {
			if (interaction === null || typeof interaction !== "object") return null;
			if (typeof interaction.answer !== "function") return null;
			var questions = interaction.questions;
			if (!Array.isArray(questions) || questions.length !== 1) return null;
			var question = questions[0];
			if (question === null || typeof question !== "object") return null;
			var intent = question.intent;
			if (intent === null || typeof intent !== "object" || intent.kind !== RATIFY_INTENT_KIND) return null;
			if (typeof intent.targetId !== "string" || intent.targetId === "") return null;
			if (question.detail === undefined || question.detail === null) return null;
			if (question.multiSelect === true) return null;
			var options = Array.isArray(question.options) ? question.options : [];
			if (options.length !== 2) return null;
			var approve = null;
			var decline = null;
			for (var index = 0; index < options.length; index += 1) {
				var option = options[index];
				if (option === null || typeof option !== "object" || typeof option.label !== "string") return null;
				if (option.label === intent.approve) approve = option;
				else decline = option;
			}
			if (approve === null || decline === null) return null;
			return {
				pending: interaction,
				id: question.id,
				targetId: intent.targetId,
				header: typeof question.header === "string" ? question.header : "",
				question: typeof question.question === "string" ? question.question : "",
				detail: question.detail,
				approve: approve,
				decline: decline
			};
		}
		//#endregion

				//#region display parsing
		/**
		 * Split a record into its frontmatter lines and its markdown body.
		 *
		 * This is DISPLAY parsing only: it reads no force fact, computes no hash and
		 * matches no consent. Those are the ratchet's, and arrive already derived in the
		 * view model. The body it returns is what the window renders as prose.
		 * @param text - the file text.
		 * @returns `{ lines, body }`, or null when the file has no opening `---`.
		 */
		function splitFrontmatter(text) {
			var normalized = String(text == null ? "" : text).replace(/^\uFEFF/, "");
			if (normalized.slice(0, 3) !== "---") return null;
			var rest = normalized.slice(3);
			var end = rest.indexOf("\n---");
			if (end === -1) return { lines: rest.split("\n"), body: "" };
			return { lines: rest.slice(0, end).split("\n"), body: rest.slice(end + 4) };
		}
		/** @returns the body with frontmatter removed, or the text unchanged. */
		function stripFrontmatter(text) {
			var split = splitFrontmatter(text);
			return split === null ? String(text == null ? "" : text) : split.body;
		}
		/**
		 * Split a markdown body into its `## <title>` sections.
		 * @param body - the markdown body.
		 * @returns an array of `{ title, lines }`; text before the first heading is
		 *   ignored, because this corpus puts nothing there.
		 */
		function bodySections(body) {
			var sections = [];
			var current = null;
			var lines = String(body == null ? "" : body).split("\n");
			for (var i = 0; i < lines.length; i += 1) {
				var heading = lines[i].match(/^##[ \t]+(.+?)[ \t]*$/);
				if (heading !== null) {
					current = { title: heading[1].trim(), lines: [] };
					sections.push(current);
					continue;
				}
				if (current !== null) current.lines.push(lines[i]);
			}
			return sections;
		}
		/** @returns the section whose title matches case-insensitively, or null. */
		function findSection(sections, title) {
			var wanted = String(title).toLowerCase();
			for (var i = 0; i < sections.length; i += 1) {
				if (String(sections[i].title).trim().toLowerCase() === wanted) return sections[i];
			}
			return null;
		}
		/**
		 * PURPOSE
		 *   Flatten a section's lines into one line of prose for the summary extractor,
		 *   removing the markdown that would otherwise be read as prose or as punctuation.
		 *
		 *   The ordered-list marker matters here rather than only at the string's start: a
		 *   Decision that opens with a paragraph and CONTINUES as `1. …` flattens to
		 *   `… points: 1. the first item`, and a first-sentence extractor then takes the
		 *   marker's own period as the sentence end, so the row renders `…: 1.`. Stripping the
		 *   marker on the line it belongs to removes the false period rather than teaching the
		 *   sentence extractor to guess.
		 *
		 * INPUTS
		 *   lines — the section's lines (an array; a non-array becomes the empty list).
		 * OUTPUTS
		 *   The readable lines joined by one space, with leading bullet, ordered-list and
		 *   heading markers and the emphasis/code marks removed. A marker-only line
		 *   contributes nothing. Never throws.
		 *
		 * KEYWORDS
		 *   summary, markdown, ordered list, marker, flatten, display only
		 */
		function plainText(lines) {
			var out = [];
			var list = Array.isArray(lines) ? lines : [];
			for (var i = 0; i < list.length; i += 1) {
				var line = String(list[i])
					.replace(/^\s*(?:[-*+]|\d+[.)])(?:[ \t]+|$)/, "")
					.replace(/^\s*#{1,6}[ \t]+/, "")
					.trim();
				if (line === "") continue;
				out.push(line.replace(/\*\*|`/g, ""));
			}
			return out.join(" ").trim();
		}
		/** @returns the first sentence of a text, or the whole text when it has none. */
		function firstSentence(text) {
			var value = String(text == null ? "" : text).trim();
			var match = value.match(/^([\s\S]*?[.!?])(\s|$)/);
			return match === null ? value : match[1];
		}
		/**
		 * PURPOSE
		 *   Strip the markdown that would otherwise be mistaken for prose before a one-line
		 *   summary is extracted: a leading bullet or ordered-list marker (`1.`, `2)`,
		 *   `- `, `* `), a leading heading marker, and emphasis or code marks. It exists
		 *   because a Decision section written as a numbered list begins
		 *   `1. **The fiction is adopted…**`, and a first-sentence extractor that runs
		 *   before this strip takes the marker's own period as the sentence end — the
		 *   summary renders as the bare text `1.`, which is the reported bug.
		 * INPUTS
		 *   text — any value; a non-string becomes the empty string.
		 * OUTPUTS
		 *   The cleaned text, trimmed. Empty, whitespace-only, or marker-only input yields
		 *   the empty string. Never throws.
		 * KEYWORDS
		 *   summary, markdown, list marker, ordered list, emphasis, extraction, display only
		 */
		function stripMarkdownLead(text) {
			var value = String(text == null ? "" : text);
			// A marker counts whether or not it is followed by text: a section whose whole
			// body is `1.` must clean to the empty string so the summary falls through,
			// rather than leaving a bare number for the first-sentence extractor to return.
			value = value.replace(/^\s*(?:[-*+]|\d+[.)])(?:\s+|$)/, "");
			value = value.replace(/^\s*#{1,6}\s+/, "");
			value = value.replace(/\*\*([^*]+)\*\*/g, "$1");
			value = value.replace(/__([^_]+)__/g, "$1");
			value = value.replace(/`([^`]+)`/g, "$1");
			value = value.replace(/\*([^*]+)\*/g, "$1");
			return value.trim();
		}
		/**
		 * Whether a text carries at least one LETTER, so a bare number, a bare list marker
		 * or punctuation alone is not accepted as a readable summary. A Unicode letter is
		 * accepted in any script (`[^\W\d_]` is a word character that is neither a digit
		 * nor an underscore), so a non-Latin title is still prose.
		 * @param text - any value.
		 * @returns true when a letter is present. Never throws.
		 */
		function hasReadableText(text) {
			return /[^\W\d_]/u.test(String(text == null ? "" : text));
		}
		/** @returns the first readable paragraph of a markdown body. */
		function firstParagraph(body) {
			var lines = String(body == null ? "" : body).split("\n");
			var buffer = [];
			var inFence = false;
			for (var i = 0; i < lines.length; i += 1) {
				var line = lines[i];
				if (/^\s*```/.test(line)) {
					inFence = !inFence;
					continue;
				}
				if (inFence) continue;
				if (/^\s*#/.test(line)) {
					if (buffer.length > 0) break;
					continue;
				}
				if (line.trim() === "") {
					if (buffer.length > 0) break;
					continue;
				}
				buffer.push(line.replace(/^\s*[-*|>]\s?/, "").trim());
			}
			return buffer.join(" ").trim();
		}
		/**
		 * Normalise the line endings and the byte-order mark of a text.
		 *
		 * On a checkout whose working tree holds CRLF (Windows, where `.gitattributes`
		 * leaves `.md` to the platform) the display parsers' anchored patterns match
		 * nothing, and a spec renders as a document with zero laws rather than as an
		 * error. Normalising at the single point where text enters the panel makes the
		 * parsers independent of how git checked the corpus out.
		 *
		 * @param value - The text as the host returned it, or anything else.
		 * @returns The text with a leading BOM removed and every CRLF/CR replaced by LF.
		 *   Non-string input becomes the empty string.
		 */
		function normaliseText(value) {
			return String(value == null ? "" : value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
		}
		/**
		 * Parse one compiled spec document into its laws and checks for display.
		 *
		 * The shape is regular: an HTML comment carrying the spec hash, `# Spec: <zone>`,
		 * `Project: <name>`, then one `## <law id>` block per law with a statement, a
		 * `- authority:` line, a `- decided in: <adr>` line, and a `- checks:` list.
		 *
		 * The component view is rendered from the documents the ratchet's `renderSpecs`
		 * returned in the view model, not from files the panel read: the panel never
		 * touches the workspace. Parsing is presentation — it turns the generated text
		 * into cards and a check histogram — and it computes no law.
		 *
		 * @param item - `{ name, path, text }` from the view model's `specs`.
		 * @returns `{ name, path, zone, project, hash, laws, counts, eof, error }`; never
		 *   throws. A field that does not parse is null and renders as `unknown`.
		 *   `counts.checks` is the number of check lines the document declares and
		 *   `counts.parsedChecks` is how many of them parsed, so a parse gap is observable
		 *   rather than silent.
		 */
		function parseSpec(item) {
			var spec = { name: item.name, path: item.path, zone: null, project: null, hash: null, laws: [], eof: item.eof !== false, error: null };
			try {
				var text = normaliseText(item.text);
				var zone = text.match(/^#[ \t]+Spec:[ \t]*(.+?)[ \t]*$/m);
				var project = text.match(/^Project:[ \t]*(.+?)[ \t]*$/m);
				var hash = text.match(/spec-hash:[ \t]*(sha256:[0-9a-fA-F]+)/);
				spec.zone = zone === null ? null : zone[1].trim();
				spec.project = project === null ? null : project[1].trim();
				spec.hash = hash === null ? null : hash[1];
				// The number of check LINES the document declares, counted independently of
				// whether each one parses into a check. `counts.checks` is this declared total
				// and `counts.parsedChecks` is what actually parsed, so a check line the type
				// pattern does not recognise is visible as a difference instead of vanishing.
				var declaredChecks = 0;
				var lines = text.split("\n");
				var law = null;
				var inChecks = false;
				for (var i = 0; i < lines.length; i += 1) {
					var line = lines[i];
					var heading = line.match(/^##[ \t]+(.+?)[ \t]*$/);
					if (heading !== null) {
						law = { id: heading[1].trim(), statement: "", authority: null, decidedIn: null, approvedBy: null, checks: [], unenforced: null };
						spec.laws.push(law);
						inChecks = false;
						continue;
					}
					if (law === null) continue;
					if (/^#[ \t]/.test(line)) {
						law = null;
						continue;
					}
					var decided = line.match(/^-[ \t]*decided in:[ \t]*([^\s(]+)(?:[ \t]*\(approved by[ \t]*([^)]*)\))?/);
					if (decided !== null) {
						law.decidedIn = decided[1].trim();
						law.approvedBy = decided[2] === undefined ? null : decided[2].trim();
						continue;
					}
					var authority = line.match(/^-[ \t]*authority:[ \t]*(.+?)[ \t]*$/);
					if (authority !== null) {
						law.authority = authority[1].trim();
						continue;
					}
					// An unenforced law is rendered as `- checks: none, and this law says why:
					// <reason>` (or `…none, and the law does not say why…` when the record
					// gave none), and a partly-covered law carries `- not fully covered:
					// <reason>` after its check list. Both are captured here so the expanded
					// law row can state why nothing checks it — the reason is a fact the
					// document already carries, not something this parser decides.
					var noneChecks = line.match(/^-[ \t]*checks:[ \t]*none(?:[^:]*:)?[ \t]*(.*)$/);
					if (noneChecks !== null) {
						law.unenforced = noneChecks[1].replace(/^[,;]\s*/, "").trim() || null;
						continue;
					}
					var notCovered = line.match(/^-[ \t]*not fully covered:[ \t]*(.*)$/);
					if (notCovered !== null) {
						law.unenforced = notCovered[1].trim() || null;
						continue;
					}
					if (/^-[ \t]*checks:[ \t]*$/.test(line)) {
						inChecks = true;
						continue;
					}
					if (inChecks) {
						if (/^[ \t]+-[ \t]*\S/.test(line)) declaredChecks += 1;
						var check = line.match(/^[ \t]+-[ \t]*([A-Za-z0-9_]+):[ \t]*(.*)$/);
						if (check !== null) {
							law.checks.push({ type: check[1].trim(), detail: check[2].trim() });
							continue;
						}
						if (/^-[ \t]/.test(line)) inChecks = false;
						continue;
					}
					if (law.statement === "" && line.trim() !== "" && !/^-[ \t]/.test(line)) {
						law.statement = line.trim();
					}
				}
				var checks = 0;
				for (var k = 0; k < spec.laws.length; k += 1) checks += spec.laws[k].checks.length;
				spec.counts = { laws: spec.laws.length, checks: declaredChecks, parsedChecks: checks };
			} catch (error) {
				spec.error = describeError(error);
				spec.counts = { laws: 0, checks: 0, parsedChecks: 0 };
			}
			return spec;
		}
		//#endregion

		//#region display indexing
		/**
		 * Index the compiled laws by the decision that decided them, so the decision view
		 * and the spec view agree: the same `- decided in:` line produces both. This is a
		 * presentation index over the generated documents the ratchet returned; it decides
		 * no law and no force.
		 * @param specs - parsed spec documents.
		 * @returns `{ [adrId]: [{ law, zone }] }`.
		 */
		function lawsByDecision(specs) {
			var map = {};
			for (var i = 0; i < specs.length; i += 1) {
				var spec = specs[i];
				for (var j = 0; j < spec.laws.length; j += 1) {
					var law = spec.laws[j];
					if (law.decidedIn === null || law.decidedIn === "") continue;
					if (map[law.decidedIn] === undefined) map[law.decidedIn] = [];
					map[law.decidedIn].push({ law: law, zone: spec.zone });
				}
			}
			return map;
		}
		/**
		 * The one-line summary of a decision, derived only for display.
		 *
		 * The candidates are tried in order — the Decision body section, then Context,
		 * then the body's first paragraph, then the title — and each is stripped of its
		 * markdown lead and reduced to its first READABLE sentence. A candidate that
		 * carries no letter or digit after stripping (a section that is only a list
		 * marker, say `1.`) is skipped rather than returned, so a summary can never be a
		 * bare number or punctuation; the function returns the empty string only when
		 * every candidate is unreadable, and the row then renders no summary line at all.
		 *
		 * @param record - the adapted decision, carrying `sections`, `body` and `title`.
		 * @returns A sentence of at most {@link SUMMARY_LIMIT} characters, or `""`.
		 */
		function decisionSummary(record) {
			var section = findSection(record.sections, "Decision") || findSection(record.sections, "Context");
			var candidates = [
				section === null ? "" : plainText(section.lines),
				firstParagraph(record.body),
				String(record.title == null ? "" : record.title)
			];
			for (var i = 0; i < candidates.length; i += 1) {
				var cleaned = stripMarkdownLead(candidates[i]);
				if (!hasReadableText(cleaned)) continue;
				var sentence = stripMarkdownLead(firstSentence(cleaned));
				if (!hasReadableText(sentence)) continue;
				return truncate(sentence, SUMMARY_LIMIT);
			}
			return "";
		}
		//#endregion

		//#region error text
		/** @returns a one-line description of a thrown value, a Remote failure or an error. */
		function describeError(error) {
			if (error === undefined || error === null) return "unknown error";
			if (typeof error === "string") return error;
			var code = typeof error.code === "string" && error.code !== "" ? error.code + ": " : "";
			var message = typeof error.message === "string" && error.message !== "" ? error.message : String(error);
			return code + message;
		}
		/** @returns the text truncated to at most `limit` characters. */
		function truncate(text, limit) {
			var value = String(text == null ? "" : text);
			return value.length <= limit ? value : value.slice(0, limit - 1) + "…";
		}
		/**
		 * Shorten one hash for display, e.g. `sha256:9a3f9532a1b4…`.
		 *
		 * It is presentation only and never feeds a rule: the caller keeps the full value in
		 * a `title`/`aria-label`, so what is shortened is never what is lost. Twelve hex
		 * characters are shown (rather than eight) because a "recorded vs current" pair must
		 * stay distinguishable to the eye while both stay short, and because the spec section
		 * has always abbreviated this way.
		 *
		 * @param hash - the hash text, or anything.
		 * @returns The shortened display form; a value too short to shorten is returned as
		 *   written (or `unknown` when empty). Never throws.
		 */
		function shortHash(hash) {
			var value = String(hash == null ? "" : hash);
			if (value.length <= 20) return value === "" ? "unknown" : value;
			var parts = value.indexOf(":") === -1 ? [value] : [value.slice(0, value.indexOf(":") + 1), value.slice(value.indexOf(":") + 1)];
			if (parts.length === 1) return parts[0].slice(0, 12) + "…";
			return parts[0] + parts[1].slice(0, 12) + "…";
		}
		/**
		 * Whether a text carries at least one full `sha256:<64 hex>` hash.
		 * @param text - any value.
		 * @returns true when a 64-hex hash is present. Never throws.
		 */
		function hasFullHash(text) {
			return /sha256:[0-9a-fA-F]{64}/.test(String(text == null ? "" : text));
		}
		/** @returns the date part of an ISO timestamp, or the value as written when it does not parse. */
		function recordedDate(value) {
			var text = String(value == null ? "" : value);
			var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
			return match === null ? text : match[1];
		}
		//#endregion

				//#region reading
		/**
		 * The zero-value panel result, so every early return has the same shape.
		 * @returns a result with no records, the default directories and no project name.
		 */
		function emptyPanel(failures, notes) {
			return {
				decisions: [],
				consents: [],
				specs: [],
				relations: { approvedBy: {}, supersededBy: {} },
				lawsByDecision: {},
				decisionIds: {},
				recordIds: {},
				needsHuman: [],
				needsHumanTruncated: null,
				dirs: { decisionsDir: DEFAULT_DECISIONS_DIR, specsDir: DEFAULT_SPECS_DIR },
				projectName: "this project",
				notes: notes === undefined ? [] : notes,
				failures: failures === undefined ? [] : failures
			};
		}
		/**
		 * PURPOSE
		 *   Fetch the ratchet's own view model for one Session. It is the panel's ONLY
		 *   data path: the window derives nothing, so a route that cannot be reached
		 *   yields a result that SAYS the state is unavailable rather than a local
		 *   fallback that would be a second implementation of the ratchet's rules.
		 *
		 * INPUTS
		 *   sessionId — the Session whose workspace the host resolves to a project root.
		 *   signal — the caller's AbortSignal, or undefined.
		 *
		 * OUTPUTS
		 *   A promise of `{ view }` when the host answered, or `{ unavailable }` with a
		 *   line naming why. Never rejects. The capability header is what authorizes the
		 *   call; the browser adds its session cookie itself and the host checks both.
		 *
		 * KEYWORDS
		 *   state route, capability token, view model, unavailable, no fallback
		 */
		function fetchState(sessionId, signal) {
			var endpoint = stateEndpoint();
			if (endpoint === null) {
				return Promise.resolve({ unavailable: "the state route is not available in this page: this process did not publish the state capability, so the ratchet's decision view cannot be read" });
			}
			if (typeof sessionId !== "string" || sessionId === "") {
				return Promise.resolve({ unavailable: "no Session is bound, so the host cannot resolve the project root the state belongs to" });
			}
			var init = { method: "GET", headers: {} };
			init.headers[STATE_HEADER] = endpoint.token;
			if (signal !== undefined && signal !== null) init.signal = signal;
			return consentRequest(endpoint.route + "?session=" + encodeURIComponent(sessionId), init).then(
				function (answer) {
					if (answer.status !== 200 || answer.body === null) {
						var detail = answer.body !== null && typeof answer.body.message === "string" ? answer.body.message : "the host answered with no readable body";
						return { unavailable: "the host refused the state request (" + answer.status + "): " + detail };
					}
					return { view: answer.body };
				},
				function (error) { return { unavailable: "the state route could not be reached: " + describeError(error) }; }
			);
		}
		/**
		 * PURPOSE
		 *   Turn the ratchet's own truncation record into the one sentence the window shows,
		 *   so a capped answer is STATED rather than silently rendered as the whole corpus.
		 *   The ratchet caps what it sends (record count and response bytes); this function
		 *   adds no cap of its own and interprets none of the numbers beyond naming them.
		 * INPUTS
		 *   truncated — the view model's `truncated` member, or any value.
		 * OUTPUTS
		 *   A non-empty sentence naming every cut the record reports, or null when the
		 *   member is absent or names no cut. Never throws.
		 * KEYWORDS
		 *   truncation, response cap, partial view, notice
		 */
		function truncationNote(truncated) {
			if (truncated === null || truncated === undefined || typeof truncated !== "object") return null;
			var parts = [];
			var records = truncated.records;
			if (records !== null && records !== undefined && typeof records === "object") {
				parts.push("only " + records.shown + " of " + records.total + " decisions are shown");
			}
			var specs = truncated.specs;
			if (specs !== null && specs !== undefined && typeof specs === "object") {
				parts.push("only " + specs.shown + " of " + specs.total + " spec documents are shown");
			}
			var texts = truncated.texts;
			if (texts !== null && texts !== undefined && typeof texts === "object") {
				parts.push(texts.dropped + " decision bodies were omitted");
			}
			var specTexts = truncated.specTexts;
			if (specTexts !== null && specTexts !== undefined && typeof specTexts === "object") {
				parts.push(specTexts.dropped + " spec bodies were omitted");
			}
			if (parts.length === 0) return null;
			return "The state answer was truncated to stay within the host's response cap: " + parts.join("; ") + ".";
		}
		/**
		 * Adapter from one record of the ratchet's view model to the shape the renderer
		 * consumes. Every force fact — `state`, `provenance`, `canRatify`, `contentHash`,
		 * `approvedBy`, `supersededBy` — is copied unchanged from the ratchet's own
		 * derivation. The only things computed here are DISPLAY: the markdown body
		 * sections and the declared-law ids, both read from the text the ratchet returned.
		 * No hash is computed, no consent is matched and no force is decided.
		 *
		 * @param record - one entry of the view model's `records`.
		 * @returns the renderer's record shape. Never throws; a missing field renders as
		 *   `unknown` or an empty list.
		 */
		function adaptRecord(record) {
			var text = typeof record.text === "string" ? record.text : "";
			var split = splitFrontmatter(text);
			var body = split === null ? text : split.body;
			return {
				id: record.id,
				path: record.path,
				title: record.title,
				type: record.type,
				status: record.status,
				authority: record.authority,
				authorName: record.authorName,
				created: record.created,
				sourcePath: record.source !== null && typeof record.source === "object" && typeof record.source.path === "string" ? record.source.path : null,
				sourceHash: record.source !== null && typeof record.source === "object" && typeof record.source.hash === "string" ? record.source.hash : null,
				ratificationAt: record.ratification !== null && typeof record.ratification === "object" && typeof record.ratification.at === "string" ? record.ratification.at : null,
				contentHash: record.contentHash === undefined ? null : record.contentHash,
				zones: Array.isArray(record.zones) ? record.zones : [],
				supersedes: Array.isArray(record.supersedes) ? record.supersedes : [],
				approves: Array.isArray(record.approves) ? record.approves : [],
				laws: (Array.isArray(record.laws) ? record.laws : []).map(function (law) {
					return law !== null && typeof law === "object" && law.id !== undefined ? law.id : String(law);
				}),
				state: record.state,
				provenance: record.provenance,
				canRatify: record.canRatify === true,
				blockedReason: typeof record.blockedReason === "string" && record.blockedReason !== "" ? record.blockedReason : null,
				body: body,
				sections: bodySections(body),
				error: null
			};
		}
		/**
		 * Adapter from one entry of the ratchet's `needsHuman` set to the shape the
		 * renderer consumes. Every field — the kind, the id, the title, the path, the
		 * reason, the action, the drafted id/path and the reason no draft exists — is
		 * copied unchanged; this maps no rule and chooses no finding. A missing field
		 * renders empty rather than being inferred.
		 *
		 * @param entry - one element of the view model's `needsHuman`.
		 * @returns the renderer's needs-human shape. Never throws.
		 */
		function adaptNeed(entry) {
			if (entry === null || entry === undefined || typeof entry !== "object") return null;
			var draft = entry.draft !== null && entry.draft !== undefined && typeof entry.draft === "object"
				? { id: entry.draft.id === undefined ? null : entry.draft.id, path: entry.draft.path === undefined ? null : entry.draft.path }
				: null;
			var adapted = {
				kind: typeof entry.kind === "string" ? entry.kind : "unknown",
				id: entry.id === null || entry.id === undefined ? "" : String(entry.id),
				title: typeof entry.title === "string" ? entry.title : "",
				path: typeof entry.path === "string" && entry.path !== "" ? entry.path : null,
				reason: typeof entry.reason === "string" ? entry.reason : "",
				action: typeof entry.action === "string" ? entry.action : ""
			};
			// The ratchet's own problem list, copied field by field so a card can name what is
			// wrong and the decision that governs it. The keys are added ONLY when the ratchet
			// emitted them, so an entry without them keeps the exact shape the service produced
			// — this adapter passes the set through, it does not extend it.
			if (Object.prototype.hasOwnProperty.call(entry, "problems")) {
				adapted.problems = (Array.isArray(entry.problems) ? entry.problems : []).map(function (problem) {
					if (problem === null || problem === undefined || typeof problem !== "object") return null;
					return {
						code: typeof problem.code === "string" ? problem.code : null,
						lawId: typeof problem.lawId === "string" ? problem.lawId : null,
						adrId: typeof problem.adrId === "string" && problem.adrId !== "" ? problem.adrId : null,
						message: typeof problem.message === "string" ? problem.message : null
					};
				}).filter(function (problem) { return problem !== null; });
				adapted.problemCount = typeof entry.problemCount === "number" ? entry.problemCount : null;
			}
			// Added last to keep the key order the service used, so "passes the set through
			// unchanged" stays a string equality rather than a set comparison.
			adapted.draft = draft;
			adapted.draftReason = typeof entry.draftReason === "string" ? entry.draftReason : null;
			// A blocked decision's resolve plan, copied unchanged and added last so the key
			// order still matches the service's — the adapter passes the set through, it
			// does not extend it.
			if (Object.prototype.hasOwnProperty.call(entry, "steps")) {
				var STEP_KEYS = ["op", "zone", "paths", "agentAuthority", "lawId", "target", "detail"];
				adapted.steps = (Array.isArray(entry.steps) ? entry.steps : []).map(function (step) {
					if (step === null || step === undefined || typeof step !== "object") return null;
					var copy = {};
					for (var index = 0; index < STEP_KEYS.length; index += 1) {
						var key = STEP_KEYS[index];
						if (!Object.prototype.hasOwnProperty.call(step, key)) continue;
						copy[key] = key === "paths" ? (Array.isArray(step.paths) ? step.paths.slice() : []) : step[key];
					}
					return copy;
				}).filter(function (step) { return step !== null; });
				adapted.humanRequired = entry.humanRequired === true;
			}
			return adapted;
		}
		/**
		 * Load the whole catalogue for one Session from the ratchet's view model.
		 *
		 * The directories, the project name and every force fact come from the host's
		 * answer, so the panel works in any ratchet project and owns no rule. A route that
		 * cannot be reached is a `failures` line that says the state is unavailable; the
		 * window never reads the corpus itself. The `needsHuman` set is the ratchet's own,
		 * passed through unchanged.
		 *
		 * @returns a promise for
		 *   `{ decisions, consents, specs, relations, lawsByDecision, decisionIds, recordIds, needsHuman, dirs, projectName, notes, failures }`;
		 *   never rejects.
		 */
		function loadPanel(ctx, sessionId, signal) {
			return fetchState(sessionId, signal).then(
				function (fetched) {
					if (fetched.unavailable !== undefined) return emptyPanel([fetched.unavailable]);
					var view = fetched.view === null || typeof fetched.view !== "object" ? {} : fetched.view;
					var notes = Array.isArray(view.problems)
						? view.problems.map(function (entry) {
								if (entry === null || typeof entry !== "object") return String(entry);
								var code = typeof entry.code === "string" ? entry.code + ": " : "";
								return code + (typeof entry.message === "string" ? entry.message : JSON.stringify(entry));
							})
						: [];
					// The host caps what it sends; when it cut something, the window says so
					// instead of rendering a partial list as the whole corpus.
					var truncation = truncationNote(view.truncated);
					if (truncation !== null) notes.push(truncation);
					// The needs-a-human set has its own ceiling, and its cut is stated inside the
					// section it belongs to rather than among the corpus-wide notes. The raw record
					// is carried through for that; `truncationNote` above covers the record, spec,
					// text and queue cuts.
					var needsHumanTruncated = view.truncated !== null && view.truncated !== undefined && typeof view.truncated === "object" && view.truncated.needsHuman !== null && view.truncated.needsHuman !== undefined && typeof view.truncated.needsHuman === "object"
						? view.truncated.needsHuman
						: null;
					var specs = (Array.isArray(view.specs) ? view.specs : []).map(parseSpec);
					var records = (Array.isArray(view.records) ? view.records : []).map(adaptRecord).sort(byAdrId);
					var decisions = [];
					var consents = [];
					var decisionIds = {};
					var recordIds = {};
					for (var i = 0; i < records.length; i += 1) {
						if (records[i].id !== null && records[i].id !== "") recordIds[records[i].id] = true;
					}
					for (var j = 0; j < records.length; j += 1) {
						var record = records[j];
						if (record.type === "approval") {
							consents.push(record);
							continue;
						}
						// The summary is the only per-row display derivation left; the state and
						// provenance beside it are the ratchet's.
						record.summary = decisionSummary(record);
						decisions.push(record);
						if (record.id !== null && record.id !== "") decisionIds[record.id] = true;
					}
					decisions.sort(byDecisionPriority);
					var project = view.project !== null && typeof view.project === "object" ? view.project : {};
					return {
						decisions: decisions,
						consents: consents,
						specs: specs,
						relations: { approvedBy: {}, supersededBy: {} },
						lawsByDecision: lawsByDecision(specs),
						decisionIds: decisionIds,
						recordIds: recordIds,
						needsHuman: (Array.isArray(view.needsHuman) ? view.needsHuman : []).map(adaptNeed).filter(function (entry) { return entry !== null; }),
						needsHumanTruncated: needsHumanTruncated,
						dirs: {
							decisionsDir: typeof project.decisionsDir === "string" && project.decisionsDir !== "" ? project.decisionsDir : DEFAULT_DECISIONS_DIR,
							specsDir: typeof project.specsDir === "string" && project.specsDir !== "" ? project.specsDir : DEFAULT_SPECS_DIR
						},
						projectName: typeof project.name === "string" && project.name !== "" ? project.name : "this project",
						notes: notes,
						failures: []
					};
				},
				function (error) {
					return emptyPanel(["the panel could not load: " + describeError(error)]);
				}
			);
		}
/** @returns the records ordered by id, then title. */
		function byAdrId(a, b) {
			var left = a.id === null ? "" : String(a.id);
			var right = b.id === null ? "" : String(b.id);
			if (left !== right) return left < right ? -1 : 1;
			return String(a.title === null ? "" : a.title).localeCompare(String(b.title === null ? "" : b.title));
		}
		/** @returns the presentation rank of a decision: awaiting a human, then in force, then the rest. */
		function decisionRank(record) {
			var kind = record.state === undefined || record.state === null ? "unknown" : record.state.kind;
			if (kind === "pending") return 0;
			if (kind === "active" || kind === "in-force" || kind === "ratified") return 1;
			return 2;
		}
		/** Presentation ordering only: awaiting-human decisions first, then in force, then superseded/other, each by id. */
		function byDecisionPriority(a, b) {
			var rank = decisionRank(a) - decisionRank(b);
			return rank !== 0 ? rank : byAdrId(a, b);
		}
		//#endregion

		//#region styles
		function triggerStyle(open) {
			return {
				appearance: "none",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))",
				background: open ? "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.18))" : "transparent",
				color: "var(--dsw-alias-label-secondary, inherit)",
				borderRadius: 6,
				padding: "3px 8px",
				fontSize: 12,
				lineHeight: "18px",
				cursor: "pointer"
			};
		}
		function overlayBackdropStyle() {
			return { position: "fixed", inset: 0, zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", pointerEvents: "auto" };
		}
		function overlayWindowStyle() {
			return { width: "min(980px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 14, border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", background: "var(--dsw-specific-menu, #1f1f23)", color: "var(--dsw-alias-label-primary, #eaeaea)", boxShadow: "0 18px 60px rgba(0,0,0,0.45)" };
		}
		function overlayHeaderStyle() {
			return { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))" };
		}
		function overlayBodyStyle() {
			return { padding: "12px 16px 18px", overflow: "auto", display: "grid", gap: 14 };
		}
		function sectionHeadingStyle() {
			return { margin: "4px 0 8px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7 };
		}
		function cardStyle() {
			return { border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28))", borderRadius: 10, padding: "10px 12px", background: "var(--dsw-alias-bg-l1, rgba(255,255,255,0.03))" };
		}
		function lawCardStyle() {
			return { border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22))", borderRadius: 8, padding: "8px 10px", marginTop: 6, background: "rgba(128,128,128,0.06)" };
		}
		function badgeStyle() {
			return { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, opacity: 0.9 };
		}
		function chipStyle() {
			return { fontSize: 11, padding: "1px 6px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", opacity: 0.85, whiteSpace: "nowrap" };
		}
		function derivedChipStyle() {
			return { fontStyle: "italic", borderStyle: "dashed", opacity: 0.95 };
		}
		function linkChipStyle() {
			return { cursor: "pointer", textDecoration: "underline dotted" };
		}
		/**
		 * An outlined pill: how provenance is drawn, as opposed to a filled state.
		 *
		 * A state is filled because it says where a record stands and, when it awaits a
		 * human, is the call to action. Provenance only reports how an in-force record
		 * got there, so it keeps the tone's text and border colour and drops the tint —
		 * information, not a second status.
		 * @returns the style override.
		 */
		function outlineStyle() {
			return { background: "transparent" };
		}
		function mutedStyle() {
			return { fontSize: 12, opacity: 0.7, margin: "4px 0" };
		}
		/**
		 * The collapsed row's summary line: one line, clipped rather than wrapped.
		 *
		 * The row's preview must not grow into a paragraph wall, and a summary forced onto
		 * one line by a clip keeps every row the same height; the full prose is in the
		 * expanded body, so nothing is lost, only deferred. `title` carries the untruncated
		 * summary so the ellipsis is never the only place the text exists.
		 * @returns the style object.
		 */
		function summaryStyle() {
			return { fontSize: 12, opacity: 0.85, margin: "6px 0 0", lineHeight: "18px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
		}
		function warnStyle() {
			return { fontSize: 11, color: "var(--dsw-alias-state-error-primary, #e5735f)", marginTop: 4 };
		}
		function smallButtonStyle() {
			return { appearance: "none", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", background: "transparent", color: "inherit", borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer" };
		}
		/**
		 * The box the decline commentary is typed into: a plain block, so it reads as a
		 * form and not as one more toned status pill.
		 * @returns the style object.
		 */
		function declineFormStyle() {
			return { margin: "6px 0", padding: "8px", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", borderRadius: 6 };
		}
		/**
		 * The decline reason's textarea: the browser's own control, styled only enough to sit
		 * in the row (full width, inherited colour and font) and to accept a wrapped
		 * multi-line reason rather than one clipped line.
		 * @returns the style object.
		 */
		function declineReasonInputStyle() {
			return { display: "block", width: "100%", boxSizing: "border-box", minHeight: 52, resize: "vertical", background: "transparent", color: "inherit", font: "inherit", fontSize: 12, lineHeight: "18px", padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", borderRadius: 6 };
		}
		/**
		 * The header button of a collapsible needs-human group: a full-width transparent
		 * button, so it is a control rather than a status surface and is never measured as a
		 * toned fill. Its transparent background is deliberate and unchanged from
		 * {@link smallButtonStyle}, which is what keeps it out of the colour contrast check.
		 * @returns the style object.
		 */
		function groupToggleStyle() {
			var base = smallButtonStyle();
			base.display = "flex";
			base.alignItems = "baseline";
			base.gap = 8;
			base.width = "100%";
			base.textAlign = "left";
			base.padding = "6px 8px";
			base.fontSize = 12;
			base.fontWeight = 600;
			return base;
		}
		function primaryButtonStyle(colours) {
			var base = { appearance: "none", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.45))", background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.2))", color: "inherit", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", marginTop: 8 };
			if (colours !== undefined) {
				base.border = "1px solid " + colours.border;
				base.background = colours.bg;
				base.color = colours.fg;
				base.fontWeight = 600;
			}
			return base;
		}
		function codeStyle() {
			return { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, padding: "1px 4px", borderRadius: 4, background: "rgba(128,128,128,0.18)" };
		}
		function rowHeadStyle() {
			return { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", cursor: "pointer" };
		}
		function disclosureStyle() {
			return { marginLeft: "auto", opacity: 0.6, fontSize: 11 };
		}
		function detailsStyle() {
			return { marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22))", display: "grid", gap: 6 };
		}
		function paragraphStyle() {
			return { fontSize: 12, lineHeight: "18px", margin: "4px 0" };
		}
		function subHeadingStyle() {
			return { fontSize: 12, fontWeight: 600, margin: "6px 0 2px" };
		}
		function preStyle() {
			return { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, lineHeight: "16px", whiteSpace: "pre-wrap", margin: "4px 0", padding: "6px 8px", borderRadius: 6, background: "rgba(128,128,128,0.12)" };
		}
		function listStyle() {
			return { margin: "4px 0 4px 18px", padding: 0, fontSize: 12, lineHeight: "18px" };
		}
		function listItemStyle() {
			return { margin: "2px 0" };
		}
		function metaStyle() {
			return { display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 11, opacity: 0.9 };
		}
		function metaLabelStyle() {
			return { opacity: 0.6 };
		}
		function barStyle() {
			return { display: "flex", height: 10, borderRadius: 999, overflow: "hidden", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28))", marginTop: 6 };
		}
		function accentTrackStyle() {
			return { display: "flex", gap: 10, alignItems: "stretch" };
		}
		function accentBarStyle(colours) {
			return { width: 3, borderRadius: 2, flex: "none", background: colours.fg };
		}
		function awaitingRowStyle(colours) {
			var base = cardStyle();
			base.background = colours.bg;
			base.borderColor = colours.border;
			return base;
		}
		function consentRowStyle(colours) {
			var base = cardStyle();
			base.background = colours.bg;
			base.borderColor = colours.border;
			return base;
		}
		function legendStyle() {
			return { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 };
		}
		function legendGroupLabelStyle() {
			return { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dsw-alias-label-tertiary, rgba(160,160,170,0.95))" };
		}
		function legendSeparatorStyle() {
			return { width: 1, alignSelf: "stretch", background: "var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", margin: "0 2px" };
		}
		function countsStyle() {
			return { fontSize: 11, color: "var(--dsw-alias-label-secondary, inherit)", marginTop: 2 };
		}
		function mutedInlineStyle() {
			return { fontSize: 11, color: "var(--dsw-alias-label-tertiary, rgba(160,160,170,0.95))" };
		}
		function ctaNoteStyle() {
			return { fontSize: 11, color: "var(--dsw-alias-label-tertiary, rgba(160,160,170,0.95))", marginTop: 4, lineHeight: "16px" };
		}
		/**
		 * The section navigator: a sticky row of tabs, one per part of the window.
		 *
		 * It sticks to the top of the body's own scroll container, so the four parts stay
		 * one click away however far a section is scrolled; its background is the window's
		 * own surface so rows scrolling under it do not show through.
		 * @returns the style object.
		 */
		function sectionNavStyle() {
			return {
				position: "sticky",
				top: 0,
				zIndex: 3,
				display: "flex",
				gap: 6,
				flexWrap: "wrap",
				padding: "8px 0",
				marginBottom: 6,
				background: "var(--dsw-specific-menu, #1f1f23)",
				borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))"
			};
		}
		/**
		 * One tab of {@link sectionNavStyle}, filled and outlined when it is the active
		 * part. The active fill uses the business tone's `-tertiary` tint and its primary
		 * text colour — the same pairing the consent pill uses — so the tab is a control
		 * whose label cannot be painted in its own fill.
		 * @param active - whether this tab names the part currently drawn.
		 * @returns the style object.
		 */
		function tabStyle(active) {
			return {
				appearance: "none",
				border: "1px solid " + (active ? "var(--dsw-alias-state-business-primary, #8fb8ff)" : "var(--dsw-alias-border-l2, rgba(128,128,128,0.35))"),
				background: active ? "var(--dsw-alias-state-business-tertiary, rgba(143,184,255,0.15))" : "transparent",
				color: active ? "var(--dsw-alias-state-business-primary, #8fb8ff)" : "inherit",
				borderRadius: 999,
				padding: "3px 10px",
				fontSize: 12,
				fontWeight: active ? 600 : 400,
				cursor: "pointer"
			};
		}
		/** @returns the muted one-line explanation under a section's heading. */
		function sectionNoteStyle() {
			return { fontSize: 12, color: "var(--dsw-alias-label-tertiary, rgba(160,160,170,0.95))", lineHeight: "17px", margin: "0 0 8px" };
		}
		/** A compact law row's statement: one clipped line, expanded on demand. */
		function lawStatementStyle() {
			return { fontSize: 12, lineHeight: "18px", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
		}

		//#region colour model
		/**
		 * The shell's theme tokens, read through `var(--token, fallback)` so the panel
		 * looks right in any theme and still renders if a token is missing.
		 *
		 * One helper returns the three values every status surface needs (text, tint,
		 * border), so a pill, a row accent and a row tint for the same state cannot
		 * drift apart. Only the shell's own state/label/business aliases are used; no
		 * literal palette is invented where a token exists.
		 *
		 * A BACKGROUND IS A TINT, NEVER A `-secondary` OR `-primary`: those name the
		 * solid mid and bright variants, and the theme's error pair is the same colour
		 * in dark mode (`state-error-primary` and `state-error-secondary` both resolve
		 * to red-400), so filling a pill with `-secondary` paints the text the same
		 * colour as its own background and the label disappears. The theme defines
		 * `-tertiary` for success, warn and business but has NO error tint at all, so
		 * the error background is `interactive-bg-hover-danger` — the translucent red
		 * surface the shell pairs with `state-error-primary` in its own components.
		 *
		 * @param kind - one of the semantic kinds the panel displays a state with:
		 *   `in-force`/`active`/`ratified` (success), `pending` (warn — the one that must
		 *   catch the eye), `superseded` (muted, never error), `rejected`/`withdrawn`
		 *   (error), `consent`/`human` (business), `agent`/`neutral`, `unknown` (warn),
		 *   and the check kinds `check-required`/`check-forbidden`/`check-command`.
		 * @returns `{ fg, bg, border }`, each a CSS value; unknown kinds get the neutral
		 *   tone rather than throwing.
		 */
		function tone(kind) {
			var palette = {
				success: {
					fg: "var(--dsw-alias-state-success-primary, #7ddc9a)",
					bg: "var(--dsw-alias-state-success-tertiary, rgba(125,220,154,0.14))",
					border: "var(--dsw-alias-state-success-secondary, rgba(125,220,154,0.45))"
				},
				warn: {
					fg: "var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #e8c46a))",
					bg: "var(--dsw-alias-state-warn-tertiary, rgba(232,196,106,0.16))",
					border: "var(--dsw-alias-state-warn-secondary, rgba(232,196,106,0.5))"
				},
				error: {
					fg: "var(--dsw-alias-state-error-primary, #e5735f)",
					bg: "var(--dsw-alias-interactive-bg-hover-danger, rgba(229,115,95,0.16))",
					border: "var(--dsw-alias-state-error-primary, #e5735f)"
				},
				business: {
					fg: "var(--dsw-alias-state-business-primary, #8fb8ff)",
					bg: "var(--dsw-alias-state-business-tertiary, rgba(143,184,255,0.15))",
					border: "var(--dsw-alias-state-business-primary, #8fb8ff)"
				},
				neutral: {
					fg: "var(--dsw-alias-label-secondary, inherit)",
					bg: "rgba(128,128,128,0.10)",
					border: "var(--dsw-alias-border-l2, rgba(128,128,128,0.35))"
				},
				muted: {
					fg: "var(--dsw-alias-label-tertiary, rgba(160,160,170,0.95))",
					bg: "rgba(128,128,128,0.07)",
					border: "var(--dsw-alias-border-l2, rgba(128,128,128,0.28))"
				}
			};
			var byKind = {
				"in-force": "success",
				active: "success",
				ratified: "success",
				"check-required": "success",
				pending: "warn",
				unknown: "warn",
				superseded: "muted",
				rejected: "error",
				withdrawn: "error",
				"check-forbidden": "error",
				consent: "business",
				human: "business",
				"check-command": "business",
				agent: "neutral",
				neutral: "neutral"
			};
			return palette[byKind[kind] === undefined ? "neutral" : byKind[kind]];
		}

		/** @returns the tone kind for a frontmatter status string. */
		function stateKindOfStatus(status) {
			if (status === "active") return "active";
			if (status === "proposed") return "pending";
			if (status === "superseded") return "superseded";
			if (status === "rejected" || status === "withdrawn") return status;
			return "unknown";
		}

		/** @returns the tone kind for a check type: forbidden is an error, required a need, a command the routine gate. */
		function checkKind(type) {
			var name = String(type == null ? "" : type);
			if (name.indexOf("forbidden") === 0) return "check-forbidden";
			if (name.indexOf("required") === 0) return "check-required";
			if (name === "command") return "check-command";
			return "neutral";
		}

		/** @returns the tone kind for an authority: a human's decision is a business fact, an agent's is neutral. */
		function authorityKind(authority) {
			if (authority === "human") return "human";
			if (authority === "agent") return "agent";
			return "neutral";
		}

		/**
		 * `name · authority`, collapsing to the authority alone when the name did not
		 * parse OR when the two are the same word: a record whose author is
		 * `human`/`human` must read `human`, never `human · human`.
		 * @returns the author label.
		 */
		function authorLabel(record) {
			var name = record.authorName === null || record.authorName === "" ? null : record.authorName;
			var authority = record.authority === null || record.authority === "" ? "unknown" : record.authority;
			if (name === null) return authority;
			if (name.toLowerCase() === authority.toLowerCase()) return authority;
			return name + " · " + authority;
		}
		/**
		 * The provenance pill: HOW a decision entered force, shown beside the single
		 * `in force` state, drawn OUTLINED rather than filled so it cannot be mistaken
		 * for a state of its own.
		 *
		 * A `ratified by <ids>` pill is a link when every consent it names is present in
		 * the corpus; when one cannot be resolved it renders as plain text rather than a
		 * link that would go nowhere. `agent-activated` and `human-authored` carry no link.
		 *
		 * @param provenance - `{ text, kind, link }` or null.
		 * @param recordIds - map of every record id in the corpus.
		 * @param onSelectAdr - selects/expands a record by id.
		 * @returns a pill element, or null when there is no provenance to show.
		 */
		function provenancePill(provenance, recordIds, onSelectAdr) {
			if (provenance === null || provenance === undefined) return null;
			var link = provenance.link;
			var resolvable = link !== null && link !== undefined && link.length > 0 && link.every(function (id) {
				return recordIds !== undefined && recordIds[id] === true;
			});
			var extra = Object.assign({}, outlineStyle(), resolvable ? linkChipStyle() : {});
			return pill(
				provenance.text,
				provenance.kind,
				extra,
				resolvable ? function () { onSelectAdr(link[0]); } : null
			);
		}
		//#endregion

		//#region small element helpers
		/**
		 * A chip element, optionally clickable, restyled and carrying a `title`.
		 *
		 * The `title` argument is how a shortened hash chip keeps its FULL value in the DOM:
		 * only the visible text is abbreviated, so a reader can still reach the whole hash
		 * and a test can find it. It is presentation only.
		 *
		 * @param text - the visible text (already shortened by the caller when it is a hash).
		 * @param style - optional style overrides.
		 * @param onClick - optional click handler; the chip becomes a button role when set.
		 * @param title - optional full text for the `title` attribute.
		 * @returns the chip element.
		 */
		function chip(text, style, onClick, title) {
			var props = { style: Object.assign({}, chipStyle(), style || {}) };
			if (typeof title === "string" && title !== "") props.title = title;
			if (typeof onClick === "function") {
				props.onClick = onClick;
				props.role = "button";
				props.tabIndex = 0;
			}
			return React.createElement("span", props, text);
		}
		/**
		 * A chip coloured by meaning.
		 * @param text - the label.
		 * @param kind - a {@link tone} kind.
		 * @param extra - optional style overrides (e.g. the dashed derived chip).
		 * @param onClick - optional click handler; the pill becomes a button role when set.
		 * @returns the pill element.
		 */
		function pill(text, kind, extra, onClick) {
			var colours = tone(kind);
			return chip(text, Object.assign({ color: colours.fg, background: colours.bg, borderColor: colours.border }, extra || {}), onClick);
		}
		/** @returns a monospace element. */
		function mono(text) {
			return React.createElement("code", { style: codeStyle() }, text);
		}
		/** @returns a `label: value` pair for the metadata grid. */
		function metaRow(label, value, key) {
			return [
				React.createElement("div", { key: key + "-l", style: metaLabelStyle() }, label),
				React.createElement("div", { key: key + "-v" }, value === "" || value === null || value === undefined ? "unknown" : value)
			];
		}
		/** @returns a `label: node` pair for the metadata grid, for a value that is itself an element (a pill). */
		function metaRowNode(label, node, key) {
			return [
				React.createElement("div", { key: key + "-l", style: metaLabelStyle() }, label),
				React.createElement("div", { key: key + "-v" }, node)
			];
		}
		/** @returns the provenance line: the author name and authority as one pill. */
		function authorPill(record, extra) {
			return pill(authorLabel(record), authorityKind(record.authority), extra);
		}
		/**
		 * A count and its noun, singular at exactly one.
		 * @param count - a number; anything else is treated as 0.
		 * @param noun - the singular noun.
		 * @returns e.g. `1 decision`, `3 decisions`.
		 */
		function plural(count, noun) {
			var n = typeof count === "number" && isFinite(count) ? count : 0;
			return n + " " + noun + (n === 1 ? "" : "s");
		}
		/**
		 * A section heading: the human title on top, a one-line explanation of what the
		 * part is, and — on a muted third line — the directory the section was read from.
		 * The file pattern is deliberately NOT shown — it is implementation detail — while
		 * the directory is, because that is the fact a reader needs in order to go and
		 * find the file.
		 *
		 * It is a component, so it takes the one props object React passes, not two
		 * positional arguments.
		 * @param props.title - the section title.
		 * @param props.explanation - the one-line explanation; absent renders no line.
		 * @param props.sourceDir - the resolved directory; a null, empty or absent value
		 *   renders no directory line.
		 * @returns the heading element.
		 */
		function sectionHeading(props) {
			var sourceDir = props.sourceDir;
			var explanation = props.explanation;
			return React.createElement("div", { style: { margin: "4px 0 8px" } },
				React.createElement("h3", { style: Object.assign({}, sectionHeadingStyle(), { margin: 0 }) }, props.title),
				explanation === null || explanation === undefined || explanation === "" ? null : React.createElement("p", { style: sectionNoteStyle() }, explanation),
				sourceDir === null || sourceDir === undefined || sourceDir === "" ? null : React.createElement("div", { style: mutedInlineStyle() }, sourceDir));
		}
		//#region section navigation
		/**
		 * The four parts of the window, in the order the navigator draws their tabs. The
		 * order is presentation: `needs` is the actionable part, so it leads when it has
		 * anything in it, and the three browsing parts follow.
		 */
		const SECTION_KEYS = ["needs", "decisions", "consents", "specs"];
		/** The reader-facing name and the one-line explanation of each part. */
		const SECTION_META = {
			needs: {
				label: "Needs a human",
				explanation: "Everything the ratchet reports as waiting on you — consents to record, contradictions to settle, duplicates to resolve, drifted specs and a red gate."
			},
			decisions: {
				label: "Decisions",
				explanation: "Every decision record, one compact row each; open a row for its metadata, the laws it decided and its full body."
			},
			consents: {
				label: "Consents",
				explanation: "Every approval record, naming the decision its recorded consent put into force."
			},
			specs: {
				label: "Specs",
				explanation: "The compiled law cards, grouped by zone; open a law to read its checks and any reason nothing checks it."
			}
		};
		/**
		 * The count each tab shows: how many things that part currently holds. It is a
		 * tally of what was loaded, never a derivation of force; the `needs` count is the
		 * ratchet's own set and the others are the loaded record/spec arrays.
		 * @param view - the loaded view (`needsHuman`, `decisions`, `consents`, `specs`).
		 * @returns `{ needs, decisions, consents, specs }`, each a number.
		 */
		function sectionCounts(view) {
			var list = function (value) { return Array.isArray(value) ? value.length : 0; };
			return {
				needs: list(view.needsHuman),
				decisions: list(view.decisions),
				consents: list(view.consents),
				specs: list(view.specs)
			};
		}
		/**
		 * The part the window opens on when the human has not chosen one: the first
		 * non-empty part in the navigator's order, which makes the actionable part lead
		 * when there is anything to act on, and Decisions when there is not. A corpus with
		 * nothing in any part still opens on Decisions, because that is the part a reader
		 * checks first when a project surprises them.
		 * @param view - the loaded view.
		 * @returns One of {@link SECTION_KEYS}.
		 */
		function defaultSection(view) {
			var counts = sectionCounts(view);
			for (var i = 0; i < SECTION_KEYS.length; i += 1) {
				if (counts[SECTION_KEYS[i]] > 0) return SECTION_KEYS[i];
			}
			return "decisions";
		}
		/**
		 * PURPOSE
		 *   The sticky navigator: one tab per part of the window, each carrying its name
		 *   and its count, with the active part filled. It replaces the single long scroll
		 *   — the window used to stack Needs a human, every decision, every consent and
		 *   every spec into one column — by drawing exactly one part at a time. It selects
		 *   a part and derives nothing: the counts it shows come from {@link sectionCounts}
		 *   over the view the ratchet returned.
		 *
		 * INPUTS
		 *   props.tabs - an array of `{ key, label, count }`, in draw order.
		 *   props.active - the key of the part currently drawn.
		 *   props.onSelect - called with a key when a tab is clicked.
		 *
		 * OUTPUTS
		 *   The navigator element (`role="tablist"`, one `role="tab"` button per part, each
		 *   carrying `data-adr-panel-section`). An empty tab list renders an empty
		 *   navigator. Never throws.
		 *
		 * KEYWORDS
		 *   section navigation, tabs, sticky, one part, count, active
		 */
		function SectionNav(props) {
			var tabs = Array.isArray(props.tabs) ? props.tabs : [];
			var active = props.active;
			var onSelect = props.onSelect;
			return React.createElement("div", { style: sectionNavStyle(), role: "tablist", "aria-label": "panel parts" },
				tabs.map(function (tab) {
					var selected = tab.key === active;
					return React.createElement("button", {
						key: tab.key,
						type: "button",
						role: "tab",
						"aria-selected": selected ? "true" : "false",
						"data-adr-panel-section": tab.key,
						style: tabStyle(selected),
						onClick: function () { onSelect(tab.key); }
					}, tab.label + " (" + tab.count + ")");
				}));
		}
		/** @returns the four tabs in draw order, over the loaded view. */
		function sectionTabs(view) {
			var counts = sectionCounts(view);
			return SECTION_KEYS.map(function (key) {
				return { key: key, label: SECTION_META[key].label, count: counts[key] };
			});
		}
		/**
		 * PURPOSE
		 *   Bound how many rows a section draws. The host caps what it sends, but its cap
		 *   is 500 records: a browser that builds a node tree for all of them is slow for
		 *   exactly the large corpus the window exists to make readable. This draws at most
		 *   {@link SECTION_ROW_CAP} rows and, when more are loaded, one control that
		 *   reveals the next batch and states how many of the total are shown. It is a
		 *   drawing bound only: the rows beyond the first batch are already in the loaded
		 *   view and no data is discarded.
		 *
		 * INPUTS
		 *   props.rows - an array of already-created row elements.
		 *
		 * OUTPUTS
		 *   A grid holding the first `limit` rows and, when rows remain, a button that
		 *   raises the limit and a `Showing X of Y` line. An empty array renders an empty
		 *   grid. Never throws.
		 *
		 * KEYWORDS
		 *   bounded render, row cap, show more, DOM size, large corpus
		 */
		function CappedRows(props) {
			var rows = Array.isArray(props.rows) ? props.rows : [];
			var limitState = React.useState(SECTION_ROW_CAP);
			var limit = limitState[0];
			var setLimit = limitState[1];
			var shown = rows.slice(0, limit);
			var remaining = rows.length - shown.length;
			var more = remaining <= 0 ? null : React.createElement("div", { key: "more", style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
				React.createElement("button", {
					type: "button",
					style: smallButtonStyle(),
					onClick: function () { setLimit(limit + SECTION_ROW_CAP); }
				}, "Show " + Math.min(remaining, SECTION_ROW_CAP) + " more"),
				React.createElement("span", { style: mutedInlineStyle() }, "Showing " + shown.length + " of " + rows.length));
			return React.createElement("div", { style: { display: "grid", gap: 8 } }, shown.concat(more === null ? [] : [more]));
		}
		//#endregion
		/**
		 * PURPOSE
		 *   Choose the tone a needs-human entry's kind pill is drawn in. It is a table over
		 *   the ratchet's own `kind`, never a re-judged severity: a consent takes the
		 *   business tone, a duplicate the warn tone, a contradiction and a red gate the
		 *   error tone, and a stale spec the muted tone.
		 *
		 * INPUTS
		 *   need - one adapted needs-human entry (`{ kind }`), or anything.
		 *
		 * OUTPUTS
		 *   A tone kind understood by {@link tone}; an unknown kind is `neutral`. Never
		 *   throws.
		 *
		 * KEYWORDS
		 *   needs a human, tone, kind, presentation only
		 */
		function needsKind(need) {
			var kind = need === null || need === undefined ? "" : String(need.kind);
			if (kind === "consent") return "consent";
			if (kind === "duplicate") return "pending";
			if (kind === "blocked") return "pending";
			if (kind === "stale-spec") return "superseded";
			if (kind === "contradiction" || kind === "red-gate") return "rejected";
			return "neutral";
		}
		/**
		 * PURPOSE
		 *   Find the rendered record a needs-human entry concerns, so the entry can offer
		 *   the window's existing row selection as its way in. The lookup tries the entry's
		 *   id and then its path against the records the ratchet returned; it decides no
		 *   force and invents no record.
		 *
		 * INPUTS
		 *   need - one adapted needs-human entry, or anything.
		 *   decisions - the rendered decisions.
		 *   consents - the rendered consent records.
		 *
		 * OUTPUTS
		 *   The matching record, or null when the entry concerns no record in the corpus (a
		 *   spec document and a verification report are the two such kinds). Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, record lookup, row selection, entry point
		 */
		function findConcernedRecord(need, decisions, consents) {
			if (need === null || need === undefined || typeof need !== "object") return null;
			var all = (Array.isArray(decisions) ? decisions : []).concat(Array.isArray(consents) ? consents : []);
			for (var i = 0; i < all.length; i += 1) {
				if (need.id !== "" && all[i].id === need.id) return all[i];
			}
			if (need.path !== null) {
				for (var j = 0; j < all.length; j += 1) {
					if (all[j].path === need.path) return all[j];
				}
			}
			return null;
		}
		/**
		 * PURPOSE
		 *   The resolve affordance a BLOCKED decision's card carries: the ratchet's own plan,
		 *   a **Resolve** button that asks the host to start one resolver on the ratchet's
		 *   prompt, and a **Decline with reason** flow that records why the human rejects the
		 *   proposed resolution so the next attempt can differ.
		 *
		 *   It derives nothing. The steps, whether any needs a human, and the reasons already
		 *   declined all come from the host's resolve route, which reads them from the
		 *   ratchet. It never proposes a step of its own, never edits a record, and never
		 *   mints a consent — a resolver child writes a `proposed` record and the human still
		 *   approves that through the row's own Approve.
		 *
		 * INPUTS
		 *   props.adrId — the blocked decision id. props.sessionId — the Session the window
		 *   was opened from. props.ask — `askPlan(id, sessionId)`, or `null` when the route is
		 *   unreachable. props.request — `requestResolve(id, sessionId, decision, comment)`,
		 *   or `null` likewise. props.canResolve — whether both are usable in this render.
		 *   props.onStarted — called after a resolver is started, so the window re-reads the
		 *   corpus the child will change.
		 *
		 * OUTPUTS
		 *   With no capability: the CLI command, never a button that could not work. Otherwise
		 *   the plan and the two controls. While declining: the reason box and its Confirm and
		 *   Cancel. On completion: what happened — a resolver started, a refusal recorded with
		 *   its reason, or the host's own refusal. It never renders a silent outcome.
		 *
		 *   Edge cases: a plan that needs a human renders the Resolve button disabled with the
		 *   reason, because a child spawned there could not finish; a missing plan is reported
		 *   rather than assumed; a second click while a request is in flight is refused by the
		 *   phase guard; a whitespace-only reason is sent as no reason.
		 *
		 * KEYWORDS
		 *   blocked decision, resolve plan, resolver, decline reason, no consent, automatic
		 *   resolution, subagent
		 */
		function ResolveControl(props) {
			var adrId = props.adrId;
			var sessionId = props.sessionId;
			var ask = props.ask;
			var request = props.request;
			var canResolve = props.canResolve === true && typeof ask === "function";
			var queued = props.queued === true;
			var onQueue = props.onQueue;
			var phaseState = React.useState({ kind: "idle" });
			var phase = phaseState[0];
			var setPhase = phaseState[1];
			var reasonState = React.useState("");
			var reason = reasonState[0];
			var setReason = reasonState[1];
			React.useEffect(function () {
				if (!canResolve || typeof adrId !== "string" || adrId === "") return undefined;
				var alive = true;
				ask(adrId, sessionId).then(
					function (plan) {
						if (alive) setPhase({ kind: "ready", plan: plan });
					},
					function (error) {
						if (alive) setPhase({ kind: "ready", plan: { ok: false, error: describeError(error) } });
					}
				);
				return function () { alive = false; };
			}, [adrId, canResolve]);
			if (!canResolve) {
				return React.createElement("div", { style: mutedInlineStyle() },
					"The panel's resolve route is unreachable from this window, so it cannot queue a resolution. Run from a session: ask the agent to call ",
					mono("ratchet resolve " + String(adrId)),
					" and carry out the steps it prints.");
			}
			var plan = phase.kind === "ready" || phase.kind === "done" ? phase.plan : null;
			var blockedByHuman = plan !== null && plan.humanRequired === true;
			var busy = phase.kind === "sending";
			/** Records the human's refusal and its reason, which is a per-record act. */
			var decline = function () {
				if (busy || typeof request !== "function") return;
				setPhase({ kind: "sending", plan: plan });
				request(adrId, sessionId, "decline", reason).then(
					function (result) { setPhase({ kind: "done", plan: plan, decision: "decline", result: result }); },
					function (error) { setPhase({ kind: "done", plan: plan, decision: "decline", result: { ok: false, error: describeError(error) } }); }
				);
			};
			var children = [];
			if (phase.kind === "idle") {
				children.push(React.createElement("div", { key: "loading", style: mutedInlineStyle() }, "Reading the ratchet's plan for this record…"));
			}
			var declined = plan !== null && Array.isArray(plan.declined) ? plan.declined.filter(function (entry) { return entry !== null && typeof entry.comment === "string" && entry.comment !== ""; }) : [];
			if (declined.length > 0) {
				children.push(React.createElement("div", { key: "declined", style: { margin: "4px 0" } },
					React.createElement("div", { style: { fontSize: 12, fontWeight: 600 } }, "You already declined a resolution here, because:"),
					declined.map(function (entry, index) {
						return React.createElement("div", { key: "declined" + index, style: mutedInlineStyle() }, "\u201c" + entry.comment + "\u201d");
					})));
			}
			if (phase.kind === "declining") {
				children.push(React.createElement("div", { key: "declining", style: declineFormStyle() },
					React.createElement("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, "Why is this resolution wrong?"),
					React.createElement("div", { style: mutedStyle() }, "Your reason is recorded with the refusal and read by the next resolution attempt, so it can propose something different."),
					React.createElement("textarea", {
						key: "reason",
						value: reason,
						rows: 3,
						placeholder: "What should the resolution do instead?",
						"aria-label": "Reason for declining the resolution",
						style: declineReasonInputStyle(),
						onChange: function (event) { setReason(event !== null && event !== undefined && event.target !== undefined ? String(event.target.value) : ""); }
					}),
					React.createElement("div", { key: "confirm", style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 } },
						React.createElement("button", { type: "button", style: Object.assign({}, primaryButtonStyle(tone("pending")), { marginTop: 0 }), onClick: decline }, "Record this refusal"),
						React.createElement("button", { type: "button", style: Object.assign({}, smallButtonStyle(), { marginTop: 0 }), onClick: function () { setPhase({ kind: "ready", plan: plan }); } }, "Cancel"))));
			}
			if (phase.kind === "ready" || phase.kind === "sending") {
				children.push(React.createElement("div", { key: "buttons", style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 } },
					React.createElement("button", {
						type: "button",
						disabled: blockedByHuman || typeof onQueue !== "function",
						style: Object.assign({}, queued ? smallButtonStyle() : primaryButtonStyle(tone("pending")), { marginTop: 0, opacity: blockedByHuman ? 0.5 : 1 }),
						onClick: function () { if (!blockedByHuman && typeof onQueue === "function") onQueue(adrId); }
					}, queued ? "Queued \u2014 remove" : "Resolve"),
					React.createElement("button", {
						type: "button",
						disabled: busy,
						style: Object.assign({}, smallButtonStyle(), { marginTop: 0, opacity: busy ? 0.5 : 1 }),
						onClick: function () { setPhase({ kind: "declining", plan: plan }); }
					}, "Decline with a reason")));
				if (blockedByHuman) {
					children.push(React.createElement("div", { key: "human", style: mutedInlineStyle() }, "Not queueable: this record has a step only a human can carry, so an agent would stop part-way."));
				} else if (queued) {
					children.push(React.createElement("div", { key: "queued", style: mutedInlineStyle() }, "Queued. It goes with the rest to ONE resolver when you close this window."));
				}
			}
			if (phase.kind === "done") {
				children.push(React.createElement(ConsentOutcome, { key: "outcome", decision: phase.decision, result: phase.result, mode: "resolve" }));
			}
			return React.createElement("div", { style: { marginTop: 6 } }, children);
		}

		/**
		 * PURPOSE
		 *   Render one entry of the ratchet's `needsHuman` set as a card: the kind and the
		 *   thing it names, the ratchet's own `reason` and `action` unchanged, and — when
		 *   the entry concerns a record in the corpus — a button that selects that record's
		 *   row. It decides nothing; every word it shows came from the ratchet.
		 *
		 * INPUTS
		 *   props.need - one adapted needs-human entry.
		 *   props.decisions - the rendered decisions.
		 *   props.consents - the rendered consent records.
		 *   props.onSelectAdr - selects/expands a record by id.
		 *
		 * OUTPUTS
		 *   The card element. Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, entry, reason, action, row selection
		 */
		function NeedsHumanCard(props) {
			var need = props.need;
			var record = findConcernedRecord(need, props.decisions, props.consents);
			var drafted = need.draft === null || need.draft === undefined
				? null
				: (need.draft.id === null || need.draft.id === "" ? "" : need.draft.id + " ") + (need.draft.path === null ? "" : need.draft.path);
			var problems = Array.isArray(need.problems) ? need.problems : [];
			var steps = Array.isArray(need.steps) ? need.steps : [];
			var problemRows = problems.map(function (problem, index) {
				return React.createElement("div", { key: "problem" + index, style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
					problem.code === null ? null : pill(problem.code, "neutral"),
					problem.lawId === null ? null : React.createElement("span", { style: mutedInlineStyle() }, problem.lawId),
					problem.message === null ? null : React.createElement(HashedText, { style: { fontSize: 12, lineHeight: "18px" }, text: problem.message }),
					problem.adrId === null ? null : React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: function () { props.onSelectAdr(problem.adrId); } }, "Open " + problem.adrId));
			});
			// A decision waiting for a human is ACTED ON here, not here-then-elsewhere: the row
			// this card used to point at carried the Approve and Decline, so the human had to
			// switch tab, find the record and expand it to do the one thing this card is about.
			// Only a consent gets this, because only a consent has a question to answer; every
			// other kind still offers the way IN to read the record it concerns.
			var consentControl = need.kind !== "consent" || record === null
				? null
				: React.createElement(ConsentAction, {
					adr: record,
					canAsk: props.consent === null || props.consent === undefined ? false : props.consent.canAsk === true,
					ask: props.consent === null || props.consent === undefined ? null : props.consent.ask,
					settle: props.consent === null || props.consent === undefined ? null : props.consent.settle,
					sessionId: props.consent === null || props.consent === undefined ? null : props.consent.sessionId,
					onRecorded: props.consent === null || props.consent === undefined ? null : props.consent.onRecorded,
					compact: true
				});
			var resolveControl = need.kind !== "blocked" || need.id === ""
				? null
				: React.createElement(ResolveControl, {
					adrId: need.id,
					sessionId: props.resolve === null || props.resolve === undefined ? null : props.resolve.sessionId,
					canResolve: props.resolve === null || props.resolve === undefined ? false : props.resolve.can === true,
					ask: props.resolve === null || props.resolve === undefined ? null : props.resolve.ask,
					request: props.resolve === null || props.resolve === undefined ? null : props.resolve.request,
					queued: props.resolve !== null && props.resolve !== undefined && Array.isArray(props.resolve.queuedIds) && props.resolve.queuedIds.indexOf(need.id) !== -1,
					onQueue: props.resolve === null || props.resolve === undefined ? null : props.resolve.onQueue
				});
			return React.createElement("div", { style: cardStyle() },
				React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
					pill(need.kind + " " + need.id, needsKind(need)),
					need.title === "" ? null : React.createElement("span", { style: { fontSize: 12, fontWeight: 600 } }, need.title),
					need.path === null ? null : React.createElement("span", { style: mutedInlineStyle() }, need.path)),
				need.reason === "" ? null : React.createElement(HashedText, { style: { fontSize: 12, marginTop: 4, lineHeight: "18px" }, text: need.reason }),
				problemRows.length === 0 ? null : React.createElement("div", { style: { display: "grid", gap: 4, marginTop: 4 } }, problemRows),
				need.problemCount !== null && need.problemCount !== undefined && need.problemCount > problems.length
					? React.createElement("div", { style: mutedInlineStyle() }, "showing " + problems.length + " of " + need.problemCount + " problems; the rest are in the report")
					: null,
				// The ratchet's resolve plan. A blocked decision is pending WITH these steps;
				// the window names them so the row is not a dead end. It offers no button here:
				// running the plan needs an agent, and that is a separate surface.
				steps.length === 0 ? null : React.createElement("div", { style: { display: "grid", gap: 4, marginTop: 4 } },
					React.createElement("div", { style: { fontSize: 12, fontWeight: 600 } }, "To make this ratifiable:"),
					steps.map(function (step, index) {
						return React.createElement("div", { key: "step" + index, style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
							pill(step.op === null ? "step" : step.op, "neutral"),
							step.detail === null ? null : React.createElement("span", { style: { fontSize: 12, lineHeight: "18px" } }, step.detail));
					}),
					need.humanRequired === true
						? React.createElement("div", { style: mutedInlineStyle() }, "at least one step needs a human: an agent cannot author a record or change a zone authority")
						: React.createElement("div", { style: mutedInlineStyle() }, "an agent can carry out every step; the consent that puts it in force is still yours")) ,
				drafted === null ? null : React.createElement("div", { style: mutedInlineStyle() }, "drafted: " + drafted),
				need.draftReason === null || need.draftReason === undefined ? null : React.createElement(HashedText, { style: mutedInlineStyle(), text: need.draftReason }),
				need.action === "" ? null : React.createElement(HashedText, { style: ctaNoteStyle(), text: need.action }),
				consentControl,
				resolveControl,
				// No "Open" for a consent: its action is above, and a redirect to a tab the human
				// does not need is the extra step this card exists to remove. Every other kind
				// keeps it, because reading the record it concerns is the only thing to do with it.
				record === null || need.kind === "consent" ? null : React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: function () { props.onSelectAdr(record.id); } }, "Open " + record.id));
		}
		/**
		 * PURPOSE
		 *   Render a piece of the ratchet's own text with any full `sha256:<64 hex>` value
		 *   shortened for display, keeping the FULL value in the element's `title` so nothing
		 *   is hidden and a test can still find it. It is presentation only: the hash the
		 *   ratchet computed, and every rule that rests on it, is untouched.
		 *
		 * INPUTS
		 *   props.text - the ratchet's text (a reason, an action, a problem line).
		 *   props.style - the style for the wrapper; optional.
		 *
		 * OUTPUTS
		 *   A `div` whose visible text has every full hash shortened and whose `title` carries
		 *   the full text when a full hash is present. A text without a full hash renders
		 *   unchanged and gets no `title`. Never throws.
		 *
		 * KEYWORDS
		 *   display only, hash, short display, title, not hidden, needs a human, problem line
		 */
		function HashedText(props) {
			var full = String(props.text == null ? "" : props.text);
			var nodeProps = { style: props.style };
			if (hasFullHash(full)) nodeProps.title = full;
			return React.createElement("div", nodeProps, shortenHashes(full));
		}
		/**
		 * The kinds that are a DISTINCT human act and are therefore always drawn as their own
		 * card, in this order. A consent, a contradiction and a duplicate each name one thing
		 * to settle, so folding them into a batch would hide a decision behind a count.
		 */
		const DECISION_NEED_KINDS = ["consent", "blocked", "contradiction", "duplicate"];
		/**
		 * The kinds rendered as one individual fact card after the grouped batches, because
		 * each is a standing condition rather than a batch of documents. The red gate is
		 * today the only one.
		 */
		const FACT_NEED_KINDS = ["red-gate"];
		/**
		 * The reader-facing name of a grouped batch kind. The map exists so the common batch
		 * reads as `Stale specs` rather than `stale-spec`; a kind not in it falls back to its
		 * own string with hyphens turned into spaces, so an unrecognised kind is still named.
		 */
		const NEED_GROUP_LABELS = { "stale-spec": "Stale specs", "red-gate": "Red gate" };
		/**
		 * PURPOSE
		 *   Partition the ratchet's `needsHuman` set into the three presentations the section
		 *   uses: individual decision cards, grouped batches and individual facts. It orders
		 *   the presentation — consents, contradictions, duplicates, then the grouped batches,
		 *   then the facts — and decides no finding; every entry comes from the ratchet.
		 *
		 * INPUTS
		 *   needs - the adapted `needsHuman` array, or anything.
		 *
		 * OUTPUTS
		 *   `{ cards, groups, facts }`. `cards` is the decision-shaped entries ordered consent,
		 *   contradiction, duplicate (stable within a kind); `groups` is one `{ kind, entries }`
		 *   per non-decision kind in first-seen order; `facts` is the fact-kind entries. A
		 *   non-array input yields three empty arrays. Never throws and never mutates.
		 *
		 * KEYWORDS
		 *   needs a human, grouping, decision card, batch, red gate, presentation only
		 */
		function partitionNeedsHuman(needs) {
			var list = Array.isArray(needs) ? needs : [];
			var cards = [];
			var groups = [];
			var facts = [];
			var groupAt = {};
			for (var i = 0; i < list.length; i += 1) {
				var need = list[i];
				var kind = need === null || need === undefined || need.kind === undefined ? "unknown" : String(need.kind);
				if (DECISION_NEED_KINDS.indexOf(kind) !== -1) {
					cards.push(need);
					continue;
				}
				if (FACT_NEED_KINDS.indexOf(kind) !== -1) {
					facts.push(need);
					continue;
				}
				if (groupAt[kind] === undefined) {
					groupAt[kind] = groups.length;
					groups.push({ kind: kind, entries: [] });
				}
				groups[groupAt[kind]].entries.push(need);
			}
			cards.sort(function (a, b) { return DECISION_NEED_KINDS.indexOf(a.kind) - DECISION_NEED_KINDS.indexOf(b.kind); });
			return { cards: cards, groups: groups, facts: facts };
		}
		/**
		 * PURPOSE
		 *   Shorten the hash values inside a ratchet sentence for display, so the two long
		 *   `sha256:` values in a stale-spec reason do not dominate a row. It is presentation
		 *   only: the full text stays available as the element's `title`.
		 *
		 * INPUTS
		 *   text - any value; non-strings become the empty string.
		 *
		 * OUTPUTS
		 *   The text with every `sha256:<hex>` run replaced by its shortened display form.
		 *   Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, stale spec, hash, short display, presentation only
		 */
		function shortenHashes(text) {
			return String(text == null ? "" : text).replace(/sha256:[0-9a-fA-F]+/g, function (match) { return shortHash(match); });
		}
		/**
		 * PURPOSE
		 *   The one-line statement of what a collapsed group is, for the common batch kinds.
		 *   It is fixed presentation copy, never a re-derived finding: the count beside it and
		 *   every entry it hides are the ratchet's.
		 *
		 * INPUTS
		 *   kind - the group's kind string.
		 *
		 * OUTPUTS
		 *   A sentence for `stale-spec`, otherwise the empty string. Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, group header, collapsed fact, stale spec, presentation only
		 */
		function needsGroupFact(kind) {
			if (kind === "stale-spec") return "generated spec documents no longer match the compiled bundle";
			return "";
		}
		/**
		 * PURPOSE
		 *   The count a group header shows. When the ratchet's cap cut this kind the header
		 *   says `shown of total` rather than only the entries that survived, so a truncated
		 *   batch is visibly partial instead of reading as complete.
		 *
		 * INPUTS
		 *   group - one `{ kind, entries }` from {@link partitionNeedsHuman}.
		 *   truncated - the view model's `truncated.needsHuman`, or anything.
		 *
		 * OUTPUTS
		 *   A string: `<shown> of <total>` when this kind was cut, otherwise `<count>`. Never
		 *   throws.
		 *
		 * KEYWORDS
		 *   needs a human, group header, count, truncation, partial batch
		 */
		function needsGroupCount(group, truncated) {
			var shown = group.entries.length;
			if (truncated !== null && truncated !== undefined && typeof truncated === "object" && Array.isArray(truncated.kinds)) {
				for (var i = 0; i < truncated.kinds.length; i += 1) {
					var cut = truncated.kinds[i];
					if (cut !== null && cut !== undefined && cut.kind === group.kind) {
						return cut.shown + " of " + cut.total;
					}
				}
			}
			return String(shown);
		}
		/**
		 * PURPOSE
		 *   Turn the ratchet's `truncated.needsHuman` record into the one sentence the section
		 *   shows, naming the total, the shown count and every kind that lost an entry. It
		 *   exists so a cut set is STATED in the section it belongs to rather than rendered as
		 *   the whole to-do list.
		 *
		 * INPUTS
		 *   truncated - the view model's `truncated.needsHuman`, or anything.
		 *
		 * OUTPUTS
		 *   A non-empty sentence, or null when the member is absent or names no cut. Never
		 *   throws.
		 *
		 * KEYWORDS
		 *   needs a human, truncation, section notice, no silent drop
		 */
		function needsTruncationNote(truncated) {
			if (truncated === null || truncated === undefined || typeof truncated !== "object") return null;
			if (truncated.shown === undefined || truncated.total === undefined) return null;
			var text = "the needs-a-human set was cut to stay within the host's response cap: " + truncated.shown + " of " + truncated.total + " entries are shown";
			var cuts = [];
			if (Array.isArray(truncated.kinds)) {
				for (var i = 0; i < truncated.kinds.length; i += 1) {
					var cut = truncated.kinds[i];
					if (cut !== null && cut !== undefined && typeof cut.kind === "string") cuts.push(cut.kind + " " + cut.shown + " of " + cut.total);
				}
			}
			if (cuts.length > 0) text += " (" + cuts.join(", ") + ")";
			return text + ".";
		}
		/**
		 * PURPOSE
		 *   One entry inside an expanded batch: the document it names and a one-line reason,
		 *   with the drafted note path and the ratchet's full action on the entry. The full
		 *   reason stays in the element's `title`, so shortening what is drawn never hides it.
		 *
		 * INPUTS
		 *   props.need - one adapted needs-human entry.
		 *
		 * OUTPUTS
		 *   The compact row element. Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, batch entry, stale spec, drafted note, action
		 */
		function NeedsHumanGroupEntry(props) {
			var need = props.need;
			var drafted = need.draft === null || need.draft === undefined
				? null
				: (need.draft.id === null || need.draft.id === "" ? "" : need.draft.id + " ") + (need.draft.path === null ? "" : need.draft.path);
			return React.createElement("div", { style: { padding: "6px 8px 6px 18px", borderTop: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))" } },
				React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
					pill(need.kind + " " + need.id, needsKind(need)),
					need.title === "" ? null : React.createElement("span", { style: { fontSize: 12, fontWeight: 600 } }, need.title),
					need.path === null || need.path === need.id ? null : React.createElement("span", { style: mutedInlineStyle() }, need.path)),
				need.reason === "" ? null : React.createElement(HashedText, { style: { fontSize: 12, marginTop: 2, lineHeight: "18px" }, text: need.reason }),
				drafted === null ? null : React.createElement("div", { style: mutedInlineStyle(), title: "drafted: " + drafted }, "drafted: " + drafted),
				need.draftReason === null || need.draftReason === undefined ? null : React.createElement(HashedText, { style: mutedInlineStyle(), text: need.draftReason }),
				need.action === "" ? null : React.createElement(HashedText, { style: ctaNoteStyle(), text: need.action }));
		}
		/**
		 * PURPOSE
		 *   One homogeneous needs-human batch as a single collapsible card: a header that
		 *   always states the batch name, its count and what it is, and — once expanded — the
		 *   batch's entries. It exists so a corpus with seven stale specs is one header rather
		 *   than seven tall cards, while every entry stays reachable and none is hidden without
		 *   the header saying so.
		 *
		 * INPUTS
		 *   props.group - one `{ kind, entries }` from {@link partitionNeedsHuman}.
		 *   props.truncated - the ratchet's `truncated.needsHuman`, or anything.
		 *
		 * OUTPUTS
		 *   The group element. Collapsed by default; a header button toggles it. Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, group, collapse, expand, count, stale specs
		 */
		function NeedsHumanGroup(props) {
			var group = props.group;
			var expandedState = React.useState(false);
			var expanded = expandedState[0];
			var setExpanded = expandedState[1];
			var label = NEED_GROUP_LABELS[group.kind] === undefined ? String(group.kind).replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }) : NEED_GROUP_LABELS[group.kind];
			var header = label + " · " + needsGroupCount(group, props.truncated);
			var fact = needsGroupFact(group.kind);
			var toggle = groupToggleStyle();
			return React.createElement("div", { style: cardStyle() },
				React.createElement("button", {
					type: "button",
					style: toggle,
					"aria-expanded": expanded ? "true" : "false",
					onClick: function () { setExpanded(!expanded); }
				},
					React.createElement("span", null, (expanded ? "▾ " : "▸ ") + header),
					React.createElement("span", { style: { marginLeft: "auto", fontWeight: 400 } }, expanded ? "hide" : "show")),
				fact === "" ? null : React.createElement("div", { style: mutedInlineStyle() }, fact),
				expanded
					? React.createElement("div", { style: { marginTop: 4 } }, group.entries.map(function (need, index) {
						return React.createElement(NeedsHumanGroupEntry, { key: String(index), need: need });
					}))
					: null);
		}
		/**
		 * PURPOSE
		 *   The whole **Needs a human** section: the decision-shaped cards first, then the
		 *   grouped batches, then the fact cards, with the ratchet's own truncation statement
		 *   when it cut the set. It is the one entry point for everything a human must settle,
		 *   and it renders the ratchet's set unchanged and in the ratchet's order.
		 *
		 * INPUTS
		 *   props.needs - the adapted `needsHuman` array.
		 *   props.decisions - the rendered decisions, for the record lookup.
		 *   props.consents - the rendered consent records, for the record lookup.
		 *   props.onSelectAdr - selects/expands a record by id.
		 *   props.truncated - the ratchet's `truncated.needsHuman`, or anything.
		 *
		 * OUTPUTS
		 *   The section element. An empty set renders the visible empty line, never a hidden
		 *   section. Never throws.
		 *
		 * KEYWORDS
		 *   needs a human, section, entry point, grouped batches, empty state, truncation
		 */
		function NeedsHumanSection(props) {
			var all = Array.isArray(props.needs) ? props.needs : [];
			// The client-side drawing bound, on top of the host's own cap. The entries past
			// it are loaded and the line below states how many are held back, so a bounded
			// section never reads as a short one.
			var needs = all.slice(0, SECTION_ROW_CAP);
			var heldBack = all.length - needs.length;
			var truncation = needsTruncationNote(props.truncated);
			var body;
			if (needs.length === 0) {
				body = truncation === null
					? React.createElement("p", { style: mutedStyle() }, "Nothing needs a human: no decision waits for consent, no contradiction or duplicate is open, no spec has drifted, and the last recorded verification is green.")
					: React.createElement("p", { style: mutedStyle() }, "Nothing needs a human in the part of the set that was returned, but " + truncation);
			} else {
				var parts = partitionNeedsHuman(needs);
				var children = [];
				if (truncation !== null) children.push(React.createElement("p", { key: "truncated", style: warnStyle() }, truncation));
				if (heldBack > 0) children.push(React.createElement("p", { key: "heldback", style: mutedStyle() }, "Showing " + needs.length + " of " + all.length + " needs-a-human entries; the rest are loaded and listed by the ratchet but not drawn here."));
				parts.cards.forEach(function (need, index) {
					children.push(React.createElement(NeedsHumanCard, { key: "card" + index, need: need, decisions: props.decisions, consents: props.consents, onSelectAdr: props.onSelectAdr, resolve: props.resolve, consent: props.consent }));
				});
				parts.groups.forEach(function (group, index) {
					children.push(React.createElement(NeedsHumanGroup, { key: "group" + index, group: group, truncated: props.truncated }));
				});
				parts.facts.forEach(function (need, index) {
					children.push(React.createElement(NeedsHumanCard, { key: "fact" + index, need: need, decisions: props.decisions, consents: props.consents, onSelectAdr: props.onSelectAdr, resolve: props.resolve, consent: props.consent }));
				});
				body = React.createElement("div", { style: { display: "grid", gap: 8 } }, children);
			}
			return React.createElement("div", null,
				React.createElement(sectionHeading, { title: SECTION_META.needs.label, explanation: SECTION_META.needs.explanation }),
				body);
		}
		//#endregion

		//#region markdown rendering
		/**
		 * Render a body section's lines as paragraphs, bullet lists and fenced code.
		 * @param lines - the section's markdown lines.
		 * @returns an array of React elements; never throws on odd input.
		 */
		function renderBlocks(lines) {
			var out = [];
			var buffer = [];
			var i = 0;
			function flush() {
				if (buffer.length === 0) return;
				out.push(React.createElement("p", { key: "p" + out.length, style: paragraphStyle() }, buffer.join(" ")));
				buffer = [];
			}
			while (i < lines.length) {
				var line = String(lines[i]);
				if (/^\s*```/.test(line)) {
					flush();
					var code = [];
					i += 1;
					while (i < lines.length && !/^\s*```/.test(String(lines[i]))) {
						code.push(String(lines[i]));
						i += 1;
					}
					i += 1;
					out.push(React.createElement("pre", { key: "c" + out.length, style: preStyle() }, React.createElement("code", null, code.join("\n"))));
					continue;
				}
				var heading = line.match(/^#{3,6}[ \t]+(.+)$/);
				if (heading !== null) {
					flush();
					out.push(React.createElement("div", { key: "h" + out.length, style: subHeadingStyle() }, heading[1].trim()));
					i += 1;
					continue;
				}
				if (/^\s*[-*][ \t]+/.test(line)) {
					flush();
					var items = [];
					while (i < lines.length) {
						var item = String(lines[i]).match(/^\s*[-*][ \t]+(.+)$/);
						if (item === null) break;
						items.push(item[1]);
						i += 1;
					}
					out.push(React.createElement("ul", { key: "u" + out.length, style: listStyle() }, items.map(function (text, index) {
						return React.createElement("li", { key: String(index), style: listItemStyle() }, text);
					})));
					continue;
				}
				if (line.trim() === "") {
					flush();
					i += 1;
					continue;
				}
				buffer.push(line.trim());
				i += 1;
			}
			flush();
			return out;
		}
		/** @returns one body section as a heading plus its rendered blocks. */
		function SectionView(props) {
			var section = props.section;
			var blocks = renderBlocks(section.lines);
			if (blocks.length === 0) return null;
			return React.createElement("div", { style: { marginTop: 6 } },
				React.createElement("div", { style: subHeadingStyle() }, section.title),
				blocks);
		}
		/**
		 * The check kinds of one law with their counts, in first-seen order, so a compact
		 * law row can show `required_text × 2` instead of two full check lines.
		 * @param law - a parsed law, or anything.
		 * @returns an array of `{ type, count }`; `unknown` names a check whose type did
		 *   not parse, so a check never vanishes from the tally. Never throws.
		 */
		function lawCheckCounts(law) {
			var checks = law !== null && law !== undefined && Array.isArray(law.checks) ? law.checks : [];
			var counts = {};
			var order = [];
			for (var i = 0; i < checks.length; i += 1) {
				var raw = checks[i] === null || checks[i] === undefined ? "" : checks[i].type;
				var type = raw === null || raw === undefined || raw === "" ? "unknown" : String(raw);
				if (counts[type] === undefined) {
					counts[type] = 0;
					order.push(type);
				}
				counts[type] += 1;
			}
			return order.map(function (type) { return { type: type, count: counts[type] }; });
		}
		/**
		 * PURPOSE
		 *   One compiled law as a COMPACT row that expands. Collapsed it draws only the law
		 *   id, a one-line clipped statement, one toned chip per check kind with its count,
		 *   and the `decided in` chip; expanded it adds the full statement, the authority,
		 *   every check with its type and target/pattern, and — when the document carries
		 *   one — the reason nothing checks the law. It replaces a card that always drew
		 *   the full statement and every check, which turned a zone with many laws into a
		 *   wall of prose. The `decided in` chip keeps the tone of the decision it names,
		 *   so a law whose decision is superseded or awaiting a human does not read as if
		 *   it were in force.
		 *
		 * INPUTS
		 *   props.law - the parsed law, with `id`, `statement`, `authority`, `decidedIn`,
		 *     `approvedBy`, `checks` and `unenforced`.
		 *   props.decisionIds - map of decision id to boolean, for link-ability.
		 *   props.decisionStates - map of decision id to state kind, or undefined when the
		 *     caller has none; a missing entry (and an absent map) falls back to `neutral`.
		 *   props.onSelectAdr - callback receiving a decision id.
		 *
		 * OUTPUTS
		 *   The row element. Collapsed by default; the header toggles it and carries
		 *   `aria-expanded`. A law with no checks says so in its expanded body. Its
		 *   `decided in` chip is clickable only when the id is in `decisionIds`. Never
		 *   throws.
		 *
		 * KEYWORDS
		 *   spec row, law card, compact, collapse, check chips, decided in, unenforced
		 */
		function LawCard(props) {
			var law = props.law;
			var decisionIds = props.decisionIds;
			var decisionStates = props.decisionStates;
			var onSelectAdr = props.onSelectAdr;
			var linked = law.decidedIn !== null && law.decidedIn !== "" && decisionIds[law.decidedIn] === true;
			var decidedKind = decisionStates !== undefined && decisionStates !== null && law.decidedIn !== null && decisionStates[law.decidedIn] !== undefined
				? decisionStates[law.decidedIn]
				: "neutral";
			var expandedState = React.useState(false);
			var expanded = expandedState[0];
			var setExpanded = expandedState[1];
			var counts = lawCheckCounts(law);
			var children = [
				React.createElement("div", {
					key: "head",
					style: rowHeadStyle(),
					role: "button",
					tabIndex: 0,
					"aria-expanded": expanded ? "true" : "false",
					onClick: function () { setExpanded(!expanded); }
				},
					mono(law.id),
					counts.map(function (entry) {
						return pill(entry.type + " × " + entry.count, checkKind(entry.type));
					}),
					pill(
						"decided in " + (law.decidedIn === null || law.decidedIn === "" ? "unknown" : law.decidedIn),
						decidedKind,
						linked ? linkChipStyle() : null,
						linked ? function () { onSelectAdr(law.decidedIn); } : null
					),
					React.createElement("span", { style: disclosureStyle() }, expanded ? "▾" : "▸")),
				law.statement === ""
					? null
					: React.createElement("div", {
						key: "statement",
						style: expanded ? paragraphStyle() : lawStatementStyle(),
						title: law.statement
					}, expanded ? law.statement : truncate(law.statement, STATEMENT_LIMIT))
			];
			if (expanded) {
				children.push(React.createElement("div", { key: "details", style: detailsStyle() },
					React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
						pill("authority: " + (law.authority === null || law.authority === "" ? "unknown" : law.authority), authorityKind(law.authority)),
						law.approvedBy === null || law.approvedBy === undefined || law.approvedBy === "" ? null : React.createElement("span", { style: mutedInlineStyle() }, "approved by " + law.approvedBy)),
					law.checks.length === 0
						? React.createElement("div", { style: mutedStyle() }, "No checks declared.")
						: React.createElement("div", { style: { display: "grid", gap: 2 } }, law.checks.map(function (check, index) {
							return React.createElement("div", { key: String(index), style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
								pill(check.type === null || check.type === undefined || check.type === "" ? "unknown" : check.type, checkKind(check.type)),
								mono(check.detail));
						})),
					law.unenforced === null || law.unenforced === undefined || law.unenforced === "" ? null : React.createElement(HashedText, { style: ctaNoteStyle(), text: "Nothing enforces this law: " + law.unenforced })));
			}
			return React.createElement("div", { style: lawCardStyle() }, children);
		}
		/** @returns the metadata grid for one decision, with the state and author as coloured pills. */
		function metadataBlock(adr, recordIds, onSelectAdr) {
			var rows = [];
			rows = rows.concat(metaRowNode("type", pill(adr.type === null || adr.type === "" ? "unknown" : adr.type, "neutral"), "type"));
			rows = rows.concat(metaRowNode("state", React.createElement("span", null,
				pill(adr.state.text, adr.state.kind, adr.state.derived ? derivedChipStyle() : null),
				adr.state.derived ? React.createElement("span", { style: mutedInlineStyle() }, " (derived)") : null), "state"));
			if (adr.provenance !== null && adr.provenance !== undefined) {
				rows = rows.concat(metaRowNode("provenance", provenancePill(adr.provenance, recordIds, onSelectAdr), "prov"));
			}
			rows = rows.concat(metaRowNode("author", authorPill(adr), "auth"));
			rows = rows.concat(metaRow("created", adr.created, "created"));
			rows = rows.concat(metaRow("source", (adr.sourcePath === null ? "unknown" : adr.sourcePath) + " · " + shortHash(adr.sourceHash), "source"));
			rows = rows.concat(metaRow("zones", adr.zones.length === 0 ? "none" : adr.zones.join(", "), "zones"));
			rows = rows.concat(metaRow("supersedes", adr.supersedes.length === 0 ? "none" : adr.supersedes.join(", "), "supersedes"));
			rows = rows.concat(metaRow("approves", adr.approves.length === 0 ? "none" : adr.approves.join(", "), "approves"));
			rows = rows.concat(metaRow("laws declared", adr.laws.length === 0 ? "none" : adr.laws.join(", "), "laws"));
			return React.createElement("div", { style: metaStyle() }, rows);
		}
		//#endregion

		//#region components
		/**
		 * PURPOSE
		 *   Put one claimed ratification question to the human as two labelled buttons,
		 *   and send exactly the answer the human clicked. It is the consent surface: the
		 *   click settles the ratchet's own pending question, so the answer travels the
		 *   harness question channel and the ratchet records the consent from that answer
		 *   alone. This component never writes a record, never composes an answer, and
		 *   never names a label the question did not offer.
		 *
		 * INPUTS
		 *   props.claim — a value from `ratifyQuestionOf`: `{ pending, id, header,
		 *   question, detail, approve, decline }`. Only ever a non-null claim; a caller
		 *   renders nothing for a declined one.
		 *
		 * OUTPUTS
		 *   The question's own header, text and file text, the approve and decline buttons
		 *   carrying the option labels the ratchet sent, a `Not now` button that rejects
		 *   the question unanswered, and — after a failed settlement — the failure's
		 *   message. On a successful settlement it renders nothing further: the pending
		 *   interaction is gone, so React unmounts it. A thrown or rejected `answer`/`cancel`
		 *   is caught and shown; it is never allowed to escape a click handler.
		 *
		 *   Edge cases: a missing `header` renders no eyebrow rather than an empty line; a
		 *   non-string `detail` is rendered through `String` by `pre`; a second click while
		 *   a settlement is in flight is disabled by the `busy` state, because the harness
		 *   rejects a second settlement of the same pending question.
		 *
		 * KEYWORDS
		 *   ratification, consent, question channel, approve, decline, two buttons,
		 *   pending interaction, settlement, busy guard
		 */
		function RatifyAnswer(props) {
			var claim = props.claim;
			var busyState = React.useState(false);
			var busy = busyState[0];
			var setBusy = busyState[1];
			var errorState = React.useState(null);
			var error = errorState[0];
			var setError = errorState[1];
			/** Reports a settlement failure without letting it escape the click. */
			var fail = function (cause) {
				setBusy(false);
				setError(describeError(cause));
			};
			/** Watches a settlement the harness returns, so a rejection is a message. */
			var watch = function (settled) {
				if (settled !== null && typeof settled === "object" && typeof settled.then === "function") {
					settled.then(function () {
						// The interaction is gone; the parent unmounts this surface.
					}, fail);
				}
			};
			/** Sends the option's OWN label, so the consent names the answer that was shown. */
			var send = function (label) {
				setBusy(true);
				setError(null);
				try {
					watch(claim.pending.answer({ answers: [{ id: claim.id, selected: [label] }] }));
				} catch (cause) {
					fail(cause);
				}
			};
			/** Leaves the question unanswered; nothing is minted and the ratchet may re-ask. */
			var dismiss = function () {
				setBusy(true);
				setError(null);
				try {
					watch(claim.pending.cancel());
				} catch (cause) {
					fail(cause);
				}
			};
			var colours = tone("pending");
			return React.createElement("div", { style: Object.assign({}, cardStyle(), { borderColor: colours.border }) },
				claim.header === "" ? null : React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginBottom: 4 } }, claim.header),
				React.createElement("div", { style: { fontSize: 13, fontWeight: 600, lineHeight: "18px" } }, claim.question),
				React.createElement("pre", { style: preStyle() }, claim.detail),
				React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 } },
					React.createElement("button", {
						type: "button",
						disabled: busy,
						style: Object.assign({}, primaryButtonStyle(colours), { marginTop: 0 }),
						onClick: function () { send(claim.approve.label); }
					}, claim.approve.label),
					React.createElement("button", {
						type: "button",
						disabled: busy,
						style: smallButtonStyle(),
						onClick: function () { send(claim.decline.label); }
					}, claim.decline.label),
					React.createElement("button", {
						type: "button",
						disabled: busy,
						style: smallButtonStyle(),
						onClick: dismiss
					}, "Not now")),
				claim.approve.description === undefined || claim.approve.description === "" ? null
					: React.createElement("div", { style: ctaNoteStyle() }, claim.approve.description),
				React.createElement("div", { style: ctaNoteStyle() }, "Your click is the consent. Nothing is written until you choose one of the two answers."),
				error === null ? null : React.createElement("div", { style: warnStyle() }, "The answer did not settle: " + error));
		}

		/**
		 * PURPOSE
		 *   Point the human at the ratification question without putting the question in
		 *   the Conversation. An agent's decision is answered in the decision panel, and the
		 *   Conversation must not grow a second, quiz-shaped copy of it: the pointer names
		 *   the decision and opens the panel, and deliberately does NOT render the question,
		 *   its detail, or either answer label. The one exception is a grilling session,
		 *   whose question declares no panel intent and is therefore never claimed by this
		 *   entry at all.
		 *
		 * INPUTS
		 *   props.claim — a value from `ratifyQuestionOf`, used only for its `header` (which
		 *   names the decision). `props.openPanel` — the injected opener, taking the
		 *   Session id. `props.sessionId` — the composer seat's Session identity.
		 *   `props.settling` — true while a click in this record's row is being recorded,
		 *   in which case the card says so instead of offering the pointer.
		 *
		 * OUTPUTS
		 *   A card naming the decision, a sentence saying where the question is, and one
		 *   button that opens the panel. Returns the same card when `openPanel` is missing,
		 *   because a pointer with a dead button still tells the human where to look; the
		 *   click is a no-op rather than an error either way.
		 *
		 * KEYWORDS
		 *   pointer, not a quiz, decision panel, open panel, no answer surface,
		 *   conversation suppression
		 */
		function RatifyPointer(props) {
			var claim = props.claim;
			var openPanel = props.openPanel;
			var sessionId = props.sessionId;
			if (props.settling === true) {
				return React.createElement("div", { style: Object.assign({}, cardStyle(), { borderColor: tone("pending").border }) },
					React.createElement("div", { style: { fontSize: 13, fontWeight: 600, lineHeight: "18px" } }, "Recording your answer…"),
					React.createElement("div", { style: ctaNoteStyle() }, "The ratchet asked its own question for this decision and your click is being sent as the answer. Nothing is written until the ratchet reads it."));
			}
			return React.createElement("div", { style: Object.assign({}, cardStyle(), { borderColor: tone("pending").border }) },
				claim.header === "" ? null : React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginBottom: 4 } }, claim.header),
				React.createElement("div", { style: { fontSize: 13, fontWeight: 600, lineHeight: "18px" } }, "A decision is waiting for your ratification."),
				React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 } },
					React.createElement("button", {
						type: "button",
						style: Object.assign({}, primaryButtonStyle(tone("pending")), { marginTop: 0 }),
						onClick: function () {
							if (typeof openPanel === "function") openPanel(sessionId);
						}
					}, "Open the ADRs panel")),
				React.createElement("div", { style: ctaNoteStyle() }, "The question and its two answers are in the ADRs panel. Nothing is recorded until you answer it there."));
		}

		/**
		 * PURPOSE
		 *   The panel's claim on the composer seat: while the ratchet's ratification
		 *   question is pending, this entry takes the seat so the Conversation shows a
		 *   pointer instead of the harness's question card, and hands the question to the
		 *   panel window where it is actually answered. Taking the seat is what SUPPRESSES
		 *   the generic card: the seat is a chain, and an entry that claims it is the only
		 *   presentation the Session renders.
		 *
		 *   The seat is claimed only for a question `ratifyQuestionOf` accepts in full — an
		 *   unrecognised question, and in particular a grilling session's question, which
		 *   declares no panel intent, falls through to the harness's own presentation. That
		 *   fall-through is the safety net as well as the grill's intended path: if this
		 *   bundle is not loaded, nothing claims the seat and the harness asks in the
		 *   Conversation, so the question is never unanswerable.
		 *
		 * INPUTS
		 *   props.matched — the chain's elected value, which `select` returned; for this
		 *   entry it is the pending interaction. `props.publishRatify` — the injected
		 *   callback that mirrors the interaction into the panel store for the window.
		 *   `props.openPanel` and `props.sessionId` — forwarded to `RatifyPointer`.
		 *
		 * OUTPUTS
		 *   The `RatifyPointer` card for a claimable question, or `null` for anything else
		 *   (including `matched` being absent, which happens when the chain passes no
		 *   `pendingInteraction`). The effect publishes the raw INTERACTION on mount and
		 *   `null` on unmount, so the window's section appears with the question and leaves
		 *   with it; it publishes the interaction rather than a derived claim so the window
		 *   can re-apply `ratifyQuestionOf` itself and cannot be shown a surface for a value
		 *   that is no longer claimable. It publishes `null` — never the raw match — for a
		 *   question it declines, so the store can only ever hold a claimable interaction.
		 *
		 *   It settles NOTHING. A question the ratchet asked through another path is
		 *   answered by the window's own buttons, against the pending interaction they were
		 *   given; a decision a human approves in the panel never arrives here at all,
		 *   because that click goes to the host consent route instead of the composer.
		 *
		 * KEYWORDS
		 *   composer seat, chain claim, ratification, overlay hand-off, publish, unmount,
		 *   suppression, fall-through
		 */
		function RatifyComposer(props) {
			var matched = props.matched;
			var publishRatify = props.publishRatify;
			var claim = ratifyQuestionOf(matched);
			React.useEffect(function () {
				if (typeof publishRatify !== "function") return undefined;
				// `matched` is the pending interaction itself and keeps its identity while the
				// question is open, so this effect runs once per question rather than once per
				// render. The interaction — not a derived claim — is what is published: the
				// overlay re-tests it with `ratifyQuestionOf` before offering a button, so a
				// value that stopped being claimable stops being presented.
				publishRatify(ratifyQuestionOf(matched) === null ? null : matched);
				return function () {
					publishRatify(null);
				};
			}, [matched, publishRatify]);
			if (claim === null) return null;
			return React.createElement(RatifyPointer, {
				claim: claim,
				openPanel: props.openPanel,
				sessionId: props.sessionId,
				settling: false
			});
		}

		/**
		 * The Session-header action. It opens and closes the window.
		 *
		 * It composes nothing and submits nothing: the window's Approve and Decline reach
		 * the host's consent route directly, so there is no composer message to publish and
		 * no `inputActions` to hold. The button is the whole entry.
		 * @returns the header button.
		 */
		function AdrPanelTrigger(props) {
			var open = props.usePanel(function (state) {
				return state.open;
			});
			var openPanel = props.openPanel;
			var closePanel = props.closePanel;
			var sessionId = props.sessionId;
			return React.createElement("button", {
				type: "button",
				title: "Decisions and specs",
				"aria-pressed": open ? "true" : "false",
				onClick: function () {
					if (open) closePanel();
					else openPanel(sessionId);
				},
				style: triggerStyle(open)
			}, "ADRs");
		}

		/**
		 * PURPOSE
		 *   The consent surface a ratifiable decision's row carries: Approve and Decline,
		 *   the ratchet's own question about this record, and the outcome of the answer.
		 *
		 *   One click does all of it. The panel asks the host consent route for the
		 *   ratchet's question about THIS record, renders that question in the row — its
		 *   header, its text, the record's own file text and both labels the ratchet put on
		 *   it — and sends back the label belonging to the button the human pressed,
		 *   together with the question it came from. The host passes both to the ratchet,
		 *   whose `ratify` writes the approval ADR and its transcript. Nothing is composed
		 *   here: the two labels are the question's own, read through `ratifyQuestionOf`,
		 *   and no message is submitted to the composer.
		 *
		 *   A decline carries a REASON the human types. Pressing Decline shows a commentary
		 *   box rather than sending at once, so the reason is written before the refusal is
		 *   recorded; the ratchet stores it beside the refusal and nothing reads it as an
		 *   answer. An EMPTY box is sent as no reason at all, never as an empty string, so a
		 *   silent decline stays silent. An approval has no commentary box: there is nothing
		 *   to explain about a yes, and a reason sent with one would be discarded anyway.
		 *
		 * INPUTS
		 *   props.adr — the parsed decision record. props.ask — `askConsent(id, sessionId)`,
		 *   or `null` when the route is unreachable. props.settle —
		 *   `settleConsent(id, label, quiz, sessionId, comment)`, or `null` likewise.
		 *   props.sessionId — the Session the window was opened from. props.canAsk — whether
		 *   both are usable in this render. props.onRecorded — called after an approval is
		 *   written, so the window re-reads the corpus that just changed. props.compact —
		 *   render without the outer card, for embedding in a card that already has one.
		 *
		 * OUTPUTS
		 *   In the idle phase: the two buttons, or — when the route is unreachable — the CLI
		 *   command in their place. On Decline: the commentary box, its Confirm and a
		 *   Cancel, and nothing is sent until Confirm. While asking: a muted line saying the
		 *   ratchet is being asked. While recording: the ratchet's question with the record's
		 *   own text and both labels, the chosen one marked as being sent. On completion: the
		 *   outcome — an approval's id, file and transcript, a decline that says it wrote
		 *   nothing (naming the recorded reason when one was given), or the ratchet's own
		 *   refusal with its problem codes. The outcome is never silent.
		 *
		 *   Edge cases: a click when `ask`/`settle` is null reports the route as
		 *   unreachable and sends nothing; a quiz the panel cannot reduce to two labelled
		 *   answers (`claimOfQuiz` returns `null`) reports that the question cannot be put
		 *   and sends no label; a promise rejection is rendered as a message, never thrown
		 *   out of the handler; a second click while a round trip is in flight is refused by
		 *   the phase guard rather than settling one question twice; Cancel from the
		 *   commentary box returns to the two buttons and sends nothing; a reason of only
		 *   whitespace is sent as no reason.
		 *
		 * KEYWORDS
		 *   consent route, approve, decline, decline reason, commentary, ratification
		 *   question, record text, labels, outcome, no chat message, no composed answer
		 */
		function ConsentAction(props) {
			var adr = props.adr;
			var ask = props.ask;
			var settle = props.settle;
			var sessionId = props.sessionId;
			var canAsk = props.canAsk === true && typeof ask === "function" && typeof settle === "function";
			var onRecorded = props.onRecorded;
			var phaseState = React.useState(null);
			var phase = phaseState[0];
			var setPhase = phaseState[1];
			var reasonState = React.useState("");
			var reason = reasonState[0];
			var setReason = reasonState[1];
			var colours = tone(adr.state.kind);

			/** Reads the outcome out of one settle result, so the row can render it. */
			var finish = function (decision, result, quiz) {
				setPhase({ kind: "done", decision: decision, result: result, quiz: quiz });
				if (decision === "approve" && result !== null && result !== undefined && result.ok === true && typeof onRecorded === "function") {
					// The corpus changed: an approval ADR exists now. Re-reading it is how the
					// row's state, the Consents section and the in-force law set catch up.
					onRecorded();
				}
			};
			/**
			 * One click, end to end: ask the ratchet, show its question, send its label.
			 *
			 * `reason` is the human's own words and is attached to a decline only; an
			 * approval drops it, because the ratchet records no commentary for a yes.
			 */
			var decide = function (decision, comment) {
				// The commentary box is a phase of its own: it may confirm from there, but a
				// round trip already in flight is never started twice.
				if (phase !== null && phase.kind !== "declining") return;
				if (!canAsk) {
					finish(decision, { ok: false, error: "unreachable" }, null);
					return;
				}
				setPhase({ kind: "asking", decision: decision });
				ask(adr.id, sessionId).then(
					function (asked) {
						var claim = claimOfQuiz(asked === null || asked === undefined ? null : asked.quiz);
						if (claim === null) {
							finish(decision, Object.assign({ ok: false, error: "no-question" }, asked === null || asked === undefined ? {} : asked), null);
							return;
						}
						var label = decision === "decline" ? claim.decline.label : claim.approve.label;
						setPhase({ kind: "recording", decision: decision, claim: claim, label: label });
						settle(adr.id, label, asked.quiz, sessionId, decision === "decline" ? comment : null).then(
							function (result) { finish(decision, result, asked.quiz); },
							function (error) { finish(decision, { ok: false, error: describeError(error) }, asked.quiz); }
						);
					},
					function (error) { finish(decision, { ok: false, error: describeError(error) }, null); }
				);
			};

			var children = [
				React.createElement("div", { key: "note", style: ctaNoteStyle() },
					"Your click is the consent: the panel asks the ratchet for its own question about this decision, shows it here, and answers it with the ratchet's own label. Nothing is sent to the conversation.")
			];
			if (phase !== null && phase.kind === "declining") {
				children.push(
					React.createElement("div", { key: "declining", style: declineFormStyle() },
						React.createElement("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, "Why are you declining this decision?"),
						React.createElement("div", { style: mutedStyle() }, "Your reason is recorded with the refusal and read by the next resolution attempt, so it can propose something different. Leave it empty for a silent decline."),
						React.createElement("textarea", {
							key: "reason",
							value: reason,
							rows: 3,
							placeholder: "What should change before this can be approved?",
							"aria-label": "Reason for declining",
							style: declineReasonInputStyle(),
							onChange: function (event) { setReason(event !== null && event !== undefined && event.target !== undefined ? String(event.target.value) : ""); }
						}),
						React.createElement("div", { key: "confirm", style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 } },
							React.createElement("button", {
								type: "button",
								style: Object.assign({}, primaryButtonStyle(colours), { marginTop: 0 }),
								onClick: function () { decide("decline", reason); }
							}, "Decline with this reason"),
							React.createElement("button", {
								type: "button",
								style: Object.assign({}, smallButtonStyle(), { marginTop: 0 }),
								onClick: function () { setPhase(null); }
							}, "Cancel"))))
			}
			if (phase === null) {
				children.unshift(
					React.createElement("div", { key: "buttons", style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 } },
						canAsk ? React.createElement("button", {
							type: "button",
							style: Object.assign({}, primaryButtonStyle(colours), { marginTop: 0 }),
							onClick: function () { decide("approve"); }
						}, "Approve") : null,
						canAsk ? React.createElement("button", {
							type: "button",
							style: smallButtonStyle(),
							onClick: function () { setPhase({ kind: "declining" }); }
						}, "Decline") : null,
						canAsk ? null : React.createElement("span", { style: mutedStyle() },
							"The panel's host route is unreachable from this window, so it cannot record an approval. Run from a session: ask the agent to call ",
							mono("ratchet_ratify"),
							" (or list what waits with ",
							mono("node plugins/ratchet/ratchet-cli.mjs pending --root ."),
							")."))
				);
			}
			if (phase !== null && phase.kind === "asking") {
				children.push(React.createElement("div", { key: "asking", style: mutedStyle() }, "Asking the ratchet for its question about this decision…"));
			}
			if (phase !== null && phase.kind === "recording") {
				children.push(React.createElement(RatifyRouteCard, { key: "question", claim: phase.claim, decision: phase.decision, label: phase.label }));
				children.push(React.createElement("div", { key: "sending", style: mutedStyle() }, "Recording your answer: sending the ratchet's own " + phase.label + " label."));
			}
			if (phase !== null && phase.kind === "done") {
				children.push(React.createElement(ConsentOutcome, { key: "outcome", decision: phase.decision, result: phase.result }));
			}
			// Compact when it is embedded in a needs-human card: the card already has a border,
			// and a second one inside it reads as a separate object rather than as the card's
			// own action.
			return React.createElement("div", { style: props.compact === true ? { marginTop: 6 } : cardStyle() }, children);
		}

		/**
		 * PURPOSE
		 *   Renders the ratchet's own question, exactly as the ratchet built it: its
		 *   header, its text, the record's own file text and the two labels it offered. It
		 *   is the same presentation the window gives a question the ratchet asked through
		 *   the composer seat, minus the settlement, because a row's click has already
		 *   chosen the label that is being sent.
		 *
		 * INPUTS
		 *   props.claim — a value from `claimOfQuiz`. props.decision — `"approve"` or
		 *   `"decline"`. props.label — the label being sent.
		 *
		 * OUTPUTS
		 *   The question card. Both labels render as buttons, disabled: the answer is
		 *   already travelling, and one question is answered once. The chosen one carries the
		 *   primary style so the human can see which of the ratchet's labels their click
		 *   selected.
		 *
		 * KEYWORDS
		 *   question card, record text, labels, disabled while recording
		 */
		function RatifyRouteCard(props) {
			var claim = props.claim;
			var sending = props.decision === "decline" ? claim.decline.label : claim.approve.label;
			var colours = tone("pending");
			return React.createElement("div", { style: Object.assign({}, cardStyle(), { borderColor: colours.border }) },
				claim.header === "" ? null : React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginBottom: 4 } }, claim.header),
				React.createElement("div", { style: { fontSize: 13, fontWeight: 600, lineHeight: "18px" } }, claim.question),
				React.createElement("pre", { style: preStyle() }, claim.detail),
				React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 } },
					[claim.approve, claim.decline].map(function (option) {
						return React.createElement("button", {
							key: option.label,
							type: "button",
							disabled: true,
							style: Object.assign({}, option.label === sending ? primaryButtonStyle(colours) : smallButtonStyle(), { marginTop: 0, opacity: 0.7 })
						}, option.label);
					})));
		}

		/**
		 * PURPOSE
		 *   Renders what the ratchet did with the human's answer. It is the only thing that
		 *   tells the human whether a consent exists, so every outcome has a sentence: an
		 *   approval names the record written and the transcript, a decline says nothing was
		 *   written, and a refusal or a transport failure names its reason.
		 *
		 * INPUTS
		 *   props.decision — `"approve"` or `"decline"` for a consent, `"resolve"` or
		 *   `"decline"` for the resolve surface. props.result — the host's response object,
		 *   or a `{ ok: false, error }` value from a transport failure. props.mode — `"resolve"`
		 *   when the result came from the resolve route, whose vocabulary (a resolver started,
		 *   a refusal recorded, a step only a human can carry) is not a consent's; absent or
		 *   anything else renders the consent outcomes below.
		 *
		 * OUTPUTS
		 *   A muted line for a success and a warn line for anything else. It never renders
		 *   nothing, and it never claims a consent the result does not carry: `ok === true`
		 *   AND a written approval is what makes the approval sentence appear. A decline that
		 *   recorded a reason shows it back from `result.comment`, so the human can see the
		 *   words the ratchet stored rather than trusting that they went somewhere.
		 *
		 * KEYWORDS
		 *   outcome, approval written, declined, decline reason, refusal, problem codes
		 */
		function ConsentOutcome(props) {
			var result = props.result === null || props.result === undefined ? {} : props.result;
			var decision = props.decision;
			var problemEntries = Array.isArray(result.problems) ? result.problems.filter(function (entry) { return entry !== null && typeof entry === "object"; }) : [];
			var problemCodes = problemEntries.map(function (entry) { return typeof entry.code === "string" ? entry.code : null; }).filter(function (code) { return code !== null; });
			// The same code can repeat once per problem — a corpus with twelve duplicate ADR ids
			// refused with "ADR_ID_DUPLICATE" twelve times on one line — so the code line is
			// counted rather than repeated. The detail stays in the bullet list below it.
			var summarizeCodes = function (codes) {
				var counts = {};
				var order = [];
				for (var i = 0; i < codes.length; i += 1) {
					if (counts[codes[i]] === undefined) { counts[codes[i]] = 0; order.push(codes[i]); }
					counts[codes[i]] += 1;
				}
				return order.map(function (code) { return counts[code] === 1 ? code : code + " \u00d7" + counts[code]; }).join(", ");
			};
			// The ratchet's own words, not only its codes: a refusal that shows a code alone sends
			// the reader to the CLI for the reason the window exists to give them. One line per
			// problem, the code first when it has one.
			var problemLines = problemEntries.map(function (entry) { return (typeof entry.code === "string" ? entry.code + ": " : "") + (typeof entry.message === "string" ? entry.message : ""); }).filter(function (line) { return line !== ""; });
			var problemsBlock = problemLines.length === 0 ? null : React.createElement("ul", { style: { margin: "6px 0 0 18px", padding: 0 } }, problemLines.map(function (line, index) { return React.createElement("li", { key: index, style: { marginBottom: 2 } }, line); }));
			// The resolve surface's own outcomes. They are a different vocabulary from a
			// consent's — a resolver was started, a refusal was recorded, or the record needs a
			// human — so they are rendered before the consent branches, which would otherwise
			// read them as a refusal with no code.
			if (props.mode === "resolve") {
				if (result.ok === true && result.spawned === true) {
					return React.createElement("div", { style: mutedStyle() },
						"A resolver was started for this record",
						typeof result.childId === "string" && result.childId !== "" ? " (Session " + result.childId + ")" : "",
						": it is working in this project now, and whatever it proposes is a `proposed` record you still approve here.");
				}
				if (result.ok === true && result.recorded === true) {
					return React.createElement("div", { style: mutedStyle() },
						"Recorded: the ratchet stored your refusal of this resolution" + (typeof result.comment === "string" && result.comment !== "" ? " and its reason." : "."),
						typeof result.comment === "string" && result.comment !== ""
							? React.createElement("div", { style: { marginTop: 4 } }, "Recorded reason: ", React.createElement("span", { style: { fontStyle: "italic" } }, result.comment))
							: null);
				}
				if (result.humanRequired === true) {
					return React.createElement("div", { style: warnStyle() }, "No resolver was started: " + (typeof result.message === "string" && result.message !== "" ? result.message : "this record has a step only a human can carry."));
				}
				if (result.error === "unreachable") {
					return React.createElement("div", { style: warnStyle() }, "Nothing happened: this window could not reach the panel's resolve route, so the ratchet was never asked.");
				}
				if (result.error === "refused" || typeof result.error === "string") {
					return React.createElement("div", { style: warnStyle() },
						"Nothing happened: ",
						typeof result.message === "string" && result.message !== "" ? result.message : String(result.error));
				}
				return React.createElement("div", { style: warnStyle() },
					"Nothing happened",
					typeof result.message === "string" && result.message !== "" ? ": " + result.message : ".",
					problemsBlock);
			}
			var approved = result.ok === true && Array.isArray(result.ratified) && result.ratified.length > 0;
			if (approved) {
				var files = [];
				if (Array.isArray(result.wrote)) files = result.wrote.slice();
				var approvalText = result.approval !== null && result.approval !== undefined ? "Approval ADR " + result.approval.id + " (" + result.approval.path + ")" : "the approval ADR";
				var transcriptText = result.transcript !== null && result.transcript !== undefined ? " and its transcript (" + result.transcript.path + ")" : "";
				return React.createElement("div", { style: mutedStyle() },
					"Approved: " + approvalText + transcriptText + " written. ",
					"Recompile and re-verify to see the law set this changed.",
					files.length === 0 ? null : React.createElement("div", null, mono(files.join(", "))));
			}
			if (Array.isArray(result.rejected) && result.rejected.length > 0) {
				return React.createElement("div", { style: mutedStyle() },
					"Declined: the ratchet recorded no consent for " + result.rejected.join(", ") + ", so nothing was written and " + (result.rejected.length === 1 ? "the decision stays" : "the decisions stay") + " proposed.",
					typeof result.comment === "string" && result.comment !== ""
						? React.createElement("div", { style: { marginTop: 4 } }, "Recorded reason: ", React.createElement("span", { style: { fontStyle: "italic" } }, result.comment))
						: null);
			}
			if (result.error === "unreachable") {
				return React.createElement("div", { style: warnStyle() }, "Nothing was recorded: this window could not reach the panel's host route, so the ratchet was never asked.");
			}
			if (result.error === "no-question") {
				return React.createElement("div", { style: warnStyle() },
					"Nothing was recorded: the ratchet has no question to put for this decision. ",
					typeof result.message === "string" && result.message !== "" ? result.message : "It is not waiting for a human.",
					problemsBlock);
			}
			if (result.error === "refused" || typeof result.error === "string") {
				return React.createElement("div", { style: warnStyle() },
					"Nothing was recorded: ",
					typeof result.message === "string" && result.message !== "" ? result.message : String(result.error),
					problemCodes.length === 0 ? null : " (" + summarizeCodes(problemCodes) + ")",
					problemsBlock);
			}
			return React.createElement("div", { style: warnStyle() },
				"Nothing was recorded",
				problemCodes.length === 0 ? "." : ": the ratchet refused with " + summarizeCodes(problemCodes) + ".",
				decision === "decline" ? " The decision stays proposed." : null,
				problemsBlock,
				typeof result.nextStep === "string" && result.nextStep !== "" ? React.createElement("div", { style: { marginTop: 4 } }, result.nextStep) : null);
		}

		/**
		 * One decision record: identification, derived state, a summary, and — when
		 * expanded — metadata, the laws it decided, and the four body sections. Only a
		 * not-in-force decision the ratchet's queue lists as waiting gets the ratify
		 * affordance — agent- or human-authored; authorship is not what the queue keys on,
		 * because a human-authored proposed record is put into force by the human's own
		 * recorded consent, not by the file saying `authority: human`. That affordance is
		 * `ConsentAction`: two buttons whose click records the
		 * decision through the panel's host consent route, rendering the ratchet's own
		 * question and its labels, with no message submitted to the composer.
		 * @param props.decisionStates map of decision id to state kind, threaded to the
		 *   `decided in` chip of every law card this row renders.
		 * @returns the card.
		 */
		function DecisionRow(props) {
			var adr = props.adr;
			var expanded = props.expanded === true;
			var onToggle = props.onToggle;
			var laws = props.laws === undefined ? [] : props.laws;
			var decisionIds = props.decisionIds;
			var decisionStates = props.decisionStates;
			var recordIds = props.recordIds;
			var onSelectAdr = props.onSelectAdr;
			var canAsk = props.canAsk;
			var ask = props.ask;
			var settle = props.settle;
			var sessionId = props.sessionId;
			var onRecorded = props.onRecorded;
			var colours = tone(adr.state.kind);
			var awaiting = adr.state.kind === "pending";
			var children = [
				React.createElement("div", {
					key: "head",
					style: rowHeadStyle(),
					role: "button",
					tabIndex: 0,
					"aria-expanded": expanded ? "true" : "false",
					onClick: onToggle
				},
					React.createElement("span", { style: badgeStyle() }, "#" + (adr.id === null || adr.id === "" ? "????" : adr.id)),
					React.createElement("span", { style: { fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, title: adr.title }, adr.title),
					pill(adr.state.text, adr.state.kind, adr.state.derived ? derivedChipStyle() : null),
					provenancePill(adr.provenance, recordIds, onSelectAdr),
					authorPill(adr),
					React.createElement("span", { style: disclosureStyle() }, expanded ? "▾" : "▸")),
				adr.summary === "" ? null : React.createElement("div", { key: "summary", style: summaryStyle(), title: adr.summary }, adr.summary),
				adr.error === null ? null : React.createElement("div", { key: "err", style: warnStyle() }, "frontmatter: " + adr.error),
				// The ratchet's own `blockedReason` when this record cannot be ratified — the law it
				// contradicts and the resolution that would settle it. It is shown where the action
				// would be, so a blocked decision says WHY in the window instead of only a state pill.
				adr.blockedReason === null || adr.blockedReason === undefined ? null : React.createElement("div", { key: "blocked", style: warnStyle() }, adr.blockedReason)
			];
			if (adr.canRatify === true) {
				children.push(React.createElement("div", { key: "ask", style: { marginTop: 8 } },
					React.createElement(ConsentAction, {
						adr: adr,
						ask: ask,
						settle: settle,
						sessionId: sessionId,
						canAsk: canAsk,
						onRecorded: onRecorded
					})));
			}
			if (expanded) {
				children.push(React.createElement("div", { key: "details", style: detailsStyle() },
					metadataBlock(adr, recordIds, onSelectAdr),
					React.createElement("div", null,
						React.createElement("div", { style: subHeadingStyle() }, "Laws decided here (" + laws.length + ")"),
						laws.length === 0
							? React.createElement("div", { style: mutedStyle() }, "No compiled law names this decision.")
							: React.createElement("div", null, laws.map(function (entry) {
								return React.createElement(LawCard, { key: entry.law.id, law: entry.law, zone: entry.zone, decisionIds: decisionIds, decisionStates: decisionStates, onSelectAdr: onSelectAdr });
							}))),
					["Context", "Decision", "Reasoning", "Consequences"].map(function (title) {
						var section = findSection(adr.sections, title);
						return section === null ? null : React.createElement(SectionView, { key: title, section: section });
					})));
			}
			return React.createElement("div", { style: awaiting ? awaitingRowStyle(colours) : cardStyle() },
				React.createElement("div", { style: accentTrackStyle() },
					React.createElement("div", { style: accentBarStyle(colours) }),
					React.createElement("div", { style: { flex: 1, minWidth: 0 } }, children)));
		}

		/**
		 * One consent record. It shows what it approves and NEVER offers a ratify
		 * action: a consent is not a decision, and asking to ratify a consent is the
		 * unnecessary recursion.
		 * @returns the card.
		 */
		function ConsentRow(props) {
			var adr = props.adr;
			var expanded = props.expanded === true;
			var onToggle = props.onToggle;
			var colours = tone("consent");
			var children = [
				React.createElement("div", {
					key: "head",
					style: rowHeadStyle(),
					role: "button",
					tabIndex: 0,
					"aria-expanded": expanded ? "true" : "false",
					onClick: onToggle
				},
					React.createElement("span", { style: badgeStyle() }, "#" + (adr.id === null || adr.id === "" ? "????" : adr.id)),
					React.createElement("span", { style: { fontWeight: 700 } }, adr.title),
					pill("consent", "consent"),
					authorPill(adr),
					adr.ratificationAt === null || adr.ratificationAt === "" ? null : pill("recorded " + recordedDate(adr.ratificationAt), "neutral"),
					pill("approves " + (adr.approves.length === 0 ? "unknown" : adr.approves.join(", ")), adr.approves.length === 0 ? "unknown" : "consent"),
					React.createElement("span", { style: disclosureStyle() }, expanded ? "▾" : "▸")),
				adr.error === null ? null : React.createElement("div", { key: "err", style: warnStyle() }, "frontmatter: " + adr.error)
			];
			if (expanded) {
				children.push(React.createElement("div", { key: "details", style: detailsStyle() },
					adr.approves.length === 0
						? React.createElement("div", { style: mutedStyle() }, "This consent names no decision to put into force.")
						: React.createElement("div", { style: { fontSize: 12, lineHeight: "18px" } },
							"Puts ", mono(adr.approves.join(", ")), " into force at the content hash recorded in its frontmatter."),
					React.createElement("div", { style: metaStyle() }, [].concat(
						metaRow("recorded", adr.ratificationAt === null || adr.ratificationAt === "" ? "unknown" : adr.ratificationAt, "recorded"),
						metaRow("created", adr.created, "created"),
						metaRow("source", (adr.sourcePath === null ? "unknown" : adr.sourcePath) + " · " + shortHash(adr.sourceHash), "source"),
						metaRow("approves", adr.approves.length === 0 ? "none" : adr.approves.join(", "), "approves")))));
			}
			return React.createElement("div", { style: consentRowStyle(colours) },
				React.createElement("div", { style: accentTrackStyle() },
					React.createElement("div", { style: accentBarStyle(colours) }),
					React.createElement("div", { style: { flex: 1, minWidth: 0 } }, children)));
		}

		/**
		 * One compiled spec: identity, a check-kind histogram, and one law card per
		 * `##` block. The histogram is the visualization: proportional segments plus a
		 * labelled chip per check kind.
		 * @param props.decisionStates map of decision id to state kind, threaded to the
		 *   `decided in` chip of every law card in this spec.
		 * @returns the card.
		 */
		function SpecView(props) {
			var spec = props.spec;
			var decisionIds = props.decisionIds;
			var decisionStates = props.decisionStates;
			var onSelectAdr = props.onSelectAdr;
			var counts = {};
			var kinds = [];
			var counted = 0;
			for (var i = 0; i < spec.laws.length; i += 1) {
				for (var j = 0; j < spec.laws[i].checks.length; j += 1) {
					var parsedType = spec.laws[i].checks[j].type;
					var type = parsedType === null || parsedType === undefined || parsedType === "" ? "unknown" : parsedType;
					if (counts[type] === undefined) {
						counts[type] = 0;
						kinds.push(type);
					}
					counts[type] += 1;
					counted += 1;
				}
			}
			kinds.sort();
			// A parse gap must never render as an unlabelled segment: the bar is built from
			// the same array as the chips, so if their total disagrees with what the spec
			// document declares, say so rather than showing a bar that looks complete.
			var histogramComplete = counted === spec.counts.checks;
			return React.createElement("div", { style: cardStyle() },
				React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
					React.createElement("span", { style: { fontWeight: 700 } }, spec.zone === null ? spec.name : spec.zone),
					spec.project === null ? null : chip("project: " + spec.project),
					chip(shortHash(spec.hash), null, null, spec.hash),
					chip(spec.counts.laws + " law" + (spec.counts.laws === 1 ? "" : "s")),
					chip(spec.counts.checks + " check" + (spec.counts.checks === 1 ? "" : "s"))),
				spec.eof === false ? React.createElement("div", { style: warnStyle() }, "Only the first page was read, so this spec may be incomplete.") : null,
				spec.error === null || spec.error === undefined ? null : React.createElement("div", { style: warnStyle() }, spec.error),
				kinds.length === 0 ? null : React.createElement("div", null,
					React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 } }, kinds.map(function (kind) {
						return pill(kind + " × " + counts[kind], checkKind(kind));
					})),
					React.createElement("div", { style: barStyle() }, kinds.map(function (kind) {
						return React.createElement("div", {
							key: kind,
							title: kind + ": " + counts[kind],
							style: { flex: counts[kind], height: "100%", background: tone(checkKind(kind)).fg }
						});
					}))),
				histogramComplete ? null : React.createElement("div", { style: warnStyle() }, "The check histogram is incomplete: it counted " + counted + " of the " + spec.counts.checks + " checks this document declares, so at least one check could not be parsed."),
				spec.laws.length === 0
					? React.createElement("div", { style: mutedStyle() }, "No law blocks were found in this document.")
					: React.createElement("div", { style: { marginTop: 6 } },
						React.createElement(CappedRows, { rows: spec.laws.map(function (law) {
							return React.createElement(LawCard, { key: law.id, law: law, zone: spec.zone, decisionIds: decisionIds, decisionStates: decisionStates, onSelectAdr: onSelectAdr });
						}) })));
		}

		/**
		 * The colour legend, grouped by what a pill is claiming: a record's state, who
		 * put it in force, or the kind of record it is. Each group is rendered in the
		 * same shape its pills use elsewhere — states and record kinds filled, the
		 * provenance group outlined via `outlineStyle()` — so the legend is a key to
		 * what the rows look like, not a separate vocabulary.
		 *
		 * The trailing note explains the one shape that is not a group: a dashed pill.
		 * It is reference text, not a control.
		 * @returns the legend row.
		 */
		function Legend() {
			var groups = [
				{
					label: "state",
					outlined: false,
					items: [
						{ text: "in force", kind: "in-force" },
						{ text: "awaiting a human", kind: "pending" },
						{ text: "superseded", kind: "superseded" },
						{ text: "rejected / withdrawn", kind: "rejected" }
					]
				},
				{
					label: "in force by",
					outlined: true,
					items: [
						{ text: "ratified by …", kind: "ratified" },
						{ text: "agent-activated", kind: "pending" },
						{ text: "human-authored", kind: "human" }
					]
				},
				{
					label: "record",
					outlined: false,
					items: [
						{ text: "decision", kind: "neutral" },
						{ text: "consent", kind: "consent" }
					]
				}
			];
			var nodes = [];
			groups.forEach(function (group, groupIndex) {
				if (groupIndex > 0) nodes.push(React.createElement("span", { key: "sep" + groupIndex, style: legendSeparatorStyle(), "aria-hidden": "true" }));
				nodes.push(React.createElement("span", { key: "label" + groupIndex, style: legendGroupLabelStyle() }, group.label));
				group.items.forEach(function (item, itemIndex) {
					nodes.push(React.createElement("span", { key: "item" + groupIndex + "-" + itemIndex }, pill(item.text, item.kind, group.outlined ? outlineStyle() : null)));
				});
			});
			nodes.push(React.createElement("span", { key: "note", style: mutedInlineStyle() }, "a dashed pill is derived from the corpus, not read from a file"));
			return React.createElement("div", { style: legendStyle(), "aria-label": "colour legend" }, nodes);
		}

		/** @returns the failure block, or null when nothing failed. */
		function FailuresBlock(props) {
			var failures = props.failures;
			if (failures === undefined || failures === null || failures.length === 0) return null;
			return React.createElement("div", { style: { border: "1px solid var(--dsw-alias-state-error-primary, #e5735f)", borderRadius: 10, padding: "8px 10px" } },
				React.createElement("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, "Some data could not be read"),
				failures.map(function (failure, index) {
					return React.createElement("div", { key: String(index), style: { fontSize: 11, opacity: 0.85 } }, failure);
				}));
		}

		/**
		 * The full-screen window. It renders nothing while closed.
		 * @returns the overlay element, or null.
		 */
		function AdrPanelOverlay(props) {
			var state = props.usePanel(function (snapshot) {
				return snapshot;
			});
			var closePanel = props.closePanel;
			var ask = props.ask;
			var settle = props.settle;
			var load = props.load;
			var emptyView = { status: "idle", decisions: [], consents: [], specs: [], relations: { approvedBy: {}, supersededBy: {} }, lawsByDecision: {}, decisionIds: {}, recordIds: {}, needsHuman: [], needsHumanTruncated: null, dirs: { decisionsDir: DEFAULT_DECISIONS_DIR, specsDir: DEFAULT_SPECS_DIR }, projectName: "this project", notes: [], failures: [] };
			var view = React.useState(emptyView);
			var current = view[0];
			var setView = view[1];
			var selected = React.useState(null);
			var expandedId = selected[0];
			var setExpandedId = selected[1];
			// The part of the corpus the window draws. `null` means the human has not chosen
			// one, so the sensible default below applies and re-applies as the view loads;
			// once a tab is clicked the choice is remembered for the rest of the session.
			var sectionState = React.useState(null);
			var chosenSection = sectionState[0];
			var setChosenSection = sectionState[1];
			var seq = React.useState(0);
			var bump = seq[1];
			// The queue of resolutions the human has asked for. It is component state and it
			// deliberately starts NOTHING: a resolver edits the project's manifest, so the whole
			// queue goes to ONE child when the window closes rather than one child per click.
			var queuedState = React.useState([]);
			var queuedIds = queuedState[0];
			var setQueuedIds = queuedState[1];
			// A stable guard object, because state updates are asynchronous: a second close in
			// the same render would still read the old queue and dispatch it twice.
			var closeGuard = React.useState(function () { return { closing: false }; })[0];
			React.useEffect(function () {
				if (!state.open) return undefined;
				// A new open is a new batch: without this the guard set by the previous close
				// would hold for the rest of the session and the second batch would never go.
				closeGuard.closing = false;
				var controller = typeof AbortController === "function" ? new AbortController() : null;
				var alive = true;
				setView(Object.assign({}, current, { status: "loading" }));
				load(controller === null ? undefined : controller.signal).then(function (result) {
					if (!alive) return;
					setView({
						status: "ready",
						decisions: result.decisions === undefined ? [] : result.decisions,
						consents: result.consents === undefined ? [] : result.consents,
						specs: result.specs === undefined ? [] : result.specs,
						relations: result.relations === undefined ? emptyView.relations : result.relations,
						lawsByDecision: result.lawsByDecision === undefined ? {} : result.lawsByDecision,
						decisionIds: result.decisionIds === undefined ? {} : result.decisionIds,
						recordIds: result.recordIds === undefined ? {} : result.recordIds,
						needsHuman: result.needsHuman === undefined ? [] : result.needsHuman,
						needsHumanTruncated: result.needsHumanTruncated === undefined ? null : result.needsHumanTruncated,
						dirs: result.dirs === undefined ? emptyView.dirs : result.dirs,
						projectName: result.projectName === undefined ? "this project" : result.projectName,
						notes: result.notes === undefined ? [] : result.notes,
						failures: result.failures === undefined ? [] : result.failures
					});
				}, function (error) {
					if (!alive) return;
					setView(Object.assign({}, emptyView, { status: "ready", failures: ["the panel could not load: " + describeError(error)] }));
				});
				return function () {
					alive = false;
					if (controller !== null) controller.abort();
				};
			}, [state.open, state.sessionId, seq[0]]);
			React.useEffect(function () {
				if (!state.open) return undefined;
				function onKey(event) {
					if (event && event.key === "Escape") closeAndDispatch();
				}
				window.addEventListener("keydown", onKey);
				return function () {
					window.removeEventListener("keydown", onKey);
				};
			}, [state.open, closePanel]);
			if (!state.open) return null;
			// The consent route is reachable only when the host half published its capability
			// into this page AND the window is bound to a Session. Both halves are checked at
			// render time rather than cached, because a page can be opened before the host
			// route exists and a window can be opened with no Session at all.
			var canAsk = consentEndpoint() !== null && typeof state.sessionId === "string" && state.sessionId !== "";
			// The resolve capability is separate from the consent one: a page served by an
			// older host half has the consent global and not this one, and a blocked card must
			// then fall back to naming the CLI command rather than offer a button that cannot
			// work.
			var canResolve = resolveEndpoint() !== null && typeof state.sessionId === "string" && state.sessionId !== "";
			// A recorded answer changes the corpus (an Approval ADR is written), and the row
			// that recorded it knows when: it calls this, so the window re-reads the files that
			// just changed rather than waiting on a timer.
			var onRecorded = function () {
				bump(seq[0] + 1);
			};
			/** Adds or removes one record from the queue. Nothing is sent here. */
			var queueToggle = function (adrId) {
				setQueuedIds(function (current) {
					var list = Array.isArray(current) ? current : [];
					return list.indexOf(adrId) === -1 ? list.concat([adrId]) : list.filter(function (entry) { return entry !== adrId; });
				});
			};
			/**
			 * Closes the window, dispatching the queued batch first.
			 *
			 * The dispatch is deliberately not awaited: the window unmounts here, and awaiting
			 * would either delay the close or drop the request. The resolver it starts is its
			 * own Session, which is where its progress is visible. A queue the human emptied is
			 * no dispatch at all, so a close with nothing queued starts nothing.
			 */
			var closeAndDispatch = function () {
				var ids = (queuedIds || []).slice();
				setQueuedIds([]);
				// The window ALWAYS closes. A guard that could return before `closePanel` would
				// trap the human in a window they asked to leave, which is a far worse bug than a
				// double dispatch — so the guard covers the dispatch only.
				closePanel();
				if (closeGuard.closing || ids.length === 0 || !canResolve) return;
				closeGuard.closing = true;
				requestResolveBatch(ids, state.sessionId).then(function () {
					// The outcome is the resolver Session, not a line in a window that is closing.
				}, function () {
					// Same: a rejected promise here has nowhere to render, and swallowing it is
					// what keeps a close from throwing.
				});
			};
			// The ratification question the composer entry claimed and mirrored here. It is
			// re-derived rather than trusted: the store is a plain value bag, and the overlay
			// must apply the same claim test the seat did before it offers a button.
			var pendingRatify = ratifyQuestionOf(state.ratify);
			var loading = current.status === "loading";
			var awaitingCount = 0;
			var decisionStates = {};
			for (var di = 0; di < current.decisions.length; di += 1) {
				var decisionRecord = current.decisions[di];
				var decisionState = decisionRecord.state;
				if (decisionState !== undefined && decisionState !== null && decisionState.kind === "pending") awaitingCount += 1;
				if (decisionRecord.id !== null && decisionRecord.id !== "" && decisionState !== undefined && decisionState !== null && decisionState.kind !== undefined) {
					decisionStates[decisionRecord.id] = decisionState.kind;
				}
			}
			// Only the counts that are non-zero: a row of `0 consents · 0 specs` states
			// nothing, and an absent count already means none. The one count that is an
			// instruction rather than a tally — how many decisions wait for a human —
			// is rendered as its own pending pill so it cannot be skimmed past.
			var countParts = [];
			if (current.decisions.length > 0) countParts.push(plural(current.decisions.length, "decision"));
			if (current.consents.length > 0) countParts.push(plural(current.consents.length, "consent"));
			if (current.specs.length > 0) countParts.push(plural(current.specs.length, "spec"));
			var onSelectAdr = function (adrId) {
				setExpandedId(adrId);
				// A row selection always lands on the Decisions part: the laws-decided-here
				// links, the needs-human "Open <id>" buttons and a consent's `approves` link
				// all name a decision, and opening it must switch the tab to where its row is.
				setChosenSection("decisions");
			};
			var toggle = function (adrId) {
				setExpandedId(expandedId === adrId ? null : adrId);
			};
			// One part at a time: the four sections are alternatives, not a single scroll.
			// The nav says what the alternatives are and how much each holds; the body
			// below draws exactly the active one, with its own header and explanation.
			var activeSection = chosenSection === null ? defaultSection(current) : chosenSection;
			var decisionBody = current.decisions.length === 0
				? React.createElement("p", { style: mutedStyle() }, "No decision files were found in " + current.dirs.decisionsDir + ", or none could be read.")
				: React.createElement(CappedRows, { rows: current.decisions.map(function (adr) {
					return React.createElement(DecisionRow, {
						key: adr.path,
						adr: adr,
						expanded: expandedId === adr.id,
						onToggle: function () { toggle(adr.id); },
						laws: current.lawsByDecision[adr.id],
						decisionIds: current.decisionIds,
						decisionStates: decisionStates,
						recordIds: current.recordIds,
						onSelectAdr: onSelectAdr,
						canAsk: canAsk,
						ask: ask,
						settle: settle,
						sessionId: state.sessionId,
						onRecorded: onRecorded
					});
				}) });
			var consentBody = current.consents.length === 0
				? React.createElement("p", { style: mutedStyle() }, "No consent records were found in " + current.dirs.decisionsDir + ".")
				: React.createElement(CappedRows, { rows: current.consents.map(function (adr) {
					return React.createElement(ConsentRow, {
						key: adr.path,
						adr: adr,
						expanded: expandedId === adr.id,
						onToggle: function () { toggle(adr.id); }
					});
				}) });
			var specBody = current.specs.length === 0
				? React.createElement("p", { style: mutedStyle() }, "No spec files were found in " + current.dirs.specsDir + ", or none could be read.")
				: React.createElement(CappedRows, { rows: current.specs.map(function (spec) {
					return React.createElement(SpecView, { key: spec.path, spec: spec, decisionIds: current.decisionIds, decisionStates: decisionStates, onSelectAdr: onSelectAdr });
				}) });
			var sectionBody;
			if (activeSection === "needs") {
				sectionBody = React.createElement(NeedsHumanSection, {
					needs: current.needsHuman,
					truncated: current.needsHumanTruncated,
					decisions: current.decisions,
					consents: current.consents,
					onSelectAdr: onSelectAdr,
					resolve: {
						can: canResolve,
						sessionId: state.sessionId,
						ask: askPlan,
						request: requestResolve,
						queuedIds: queuedIds,
						onQueue: queueToggle
					},
					consent: {
						canAsk: canAsk,
						ask: ask,
						settle: settle,
						sessionId: state.sessionId,
						onRecorded: onRecorded
					}
				});
			} else {
				var meta = SECTION_META[activeSection] === undefined ? SECTION_META.decisions : SECTION_META[activeSection];
				var sourceDir = activeSection === "specs" ? current.dirs.specsDir : current.dirs.decisionsDir;
				sectionBody = React.createElement("div", null,
					React.createElement(sectionHeading, { title: meta.label, explanation: meta.explanation, sourceDir: sourceDir }),
					activeSection === "consents" ? consentBody : activeSection === "specs" ? specBody : decisionBody);
			}
			return React.createElement("div", { style: overlayBackdropStyle(), role: "presentation", onClick: closeAndDispatch },
				React.createElement("div", { style: overlayWindowStyle(), role: "dialog", "aria-label": "Decisions and specs", onMouseDown: function (event) { event.stopPropagation(); }, onClick: function (event) { event.stopPropagation(); } },
					React.createElement("div", { style: overlayHeaderStyle() },
						React.createElement("div", { style: { minWidth: 0 } },
							React.createElement("div", { style: { fontSize: 14, fontWeight: 600, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
								current.projectName,
								React.createElement("span", { style: { fontSize: 12, fontWeight: 400, opacity: 0.7 } }, "decisions and specs"),
								chip("adr-panel " + PANEL_VERSION)),
							React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 2 } },
								state.sessionId === null ? "no Session bound — open this from a Session header" : "viewer only — the ratchet CLI (ratchet verify) is the authority on what is enforced; every state here is derived by the ratchet and rendered unchanged"),
							React.createElement("div", { style: countsStyle() },
								countParts.length === 0 ? "nothing was read" : countParts.join(" · "),
								awaitingCount > 0
									? React.createElement("span", { style: { marginLeft: 8 } }, pill(awaitingCount + " awaiting a human", "pending"))
									: null)),
						React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
							React.createElement("button", { type: "button", style: smallButtonStyle(), disabled: loading, onClick: function () { bump(seq[0] + 1); } }, loading ? "Loading…" : "Reload"),
							React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: closeAndDispatch }, "Close"))),
					React.createElement("div", { style: overlayBodyStyle() },
						React.createElement(FailuresBlock, { failures: current.failures }),
						// The queue is stated before the sections, because what will happen on close
						// must be visible while the human is still choosing: "Resolve" now means
						// "queue", and the batch is what actually runs.
						(queuedIds || []).length === 0 ? null : React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", margin: "0 0 10px", padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", borderRadius: 6 } },
							pill((queuedIds || []).length + " queued", "pending"),
							React.createElement("span", { style: { fontSize: 12 } }, "one resolver will start for ", (queuedIds || []).length === 1 ? "this record" : "all " + (queuedIds || []).length + " records", " when you close this window"),
							React.createElement("span", { style: mutedInlineStyle() }, (queuedIds || []).join(", ")),
							React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: function () { setQueuedIds([]); } }, "Clear")),
						current.notes !== undefined && current.notes.length > 0
							? React.createElement("div", { style: warnStyle() }, current.notes.map(function (note, index) {
								return React.createElement(HashedText, { key: String(index), text: note });
							}))
							: null,
						pendingRatify === null ? null : React.createElement("div", null,
							React.createElement(sectionHeading, { title: "Awaiting your answer", sourceDir: current.dirs.decisionsDir }),
							React.createElement(RatifyAnswer, { claim: pendingRatify })),
						React.createElement(SectionNav, {
							tabs: sectionTabs(current),
							active: activeSection,
							onSelect: setChosenSection
						}),
						sectionBody,
						React.createElement(Legend, null))));
		}
		//#endregion

		//#region plugin
		/**
		 * Required browser services: the UI slot registry only. The panel's data comes
		 * from the host's state route over `fetch`, not from the workspace file API, so
		 * the Remote is deliberately NOT required: a composition without it still renders
		 * the ratchet's view, and a composition whose host half is absent says the state
		 * is unavailable rather than reading the corpus itself.
		 */
		const inject = ["slots"];

		/**
		 * Mount the header trigger, the frame-wide window, and the composer-seat claim.
		 * @param ctx - client root context carrying `slots`.
		 * @returns Nothing; all three registrations live inside `ctx.effect` scopes.
		 */
		function apply(ctx) {
			const store = createPanelStore();
			/**
			 * Mirrors the claimed ratification question into the panel store for the
			 * overlay. Defined once, outside every `inject` factory, so the component's
			 * effect dependency on it is stable and the hand-off fires once per question
			 * rather than once per render.
			 * @param claim - A value from `ratifyQuestionOf`, or `null` to clear it.
			 * @returns Nothing.
			 */
			const publishRatify = function (claim) {
				store.set({ ratify: claim === undefined ? null : claim });
			};
			/**
			 * Opens the window on one Session. Hoisted for the same reason as
			 * `publishRatify`: it is a stable identity, and three registrations need it.
			 * @param sessionId - The Session the window should read; anything that is not a
			 *   non-empty string opens it unbound, which is the viewer's own "no Session"
			 *   state rather than a crash.
			 * @returns Nothing.
			 */
			const openPanel = function (sessionId) {
				store.set({ open: true, sessionId: typeof sessionId === "string" && sessionId !== "" ? sessionId : null });
			};
			ctx.effect(function () {
				return ctx.slots.inject("conversation.session.header.actions", function () {
					return ctx.slots.register({
						name: "conversation.session.header.actions",
						id: "cc-adr-panel",
						order: 250,
						inject: function () {
							return {
								hooks: { panel: store },
								openPanel: openPanel,
								closePanel: function () {
									store.set({ open: false });
								}
							};
						}
					}, AdrPanelTrigger);
				});
			});
			ctx.effect(function () {
				return ctx.slots.inject("shell.overlay", function () {
					return ctx.slots.register({
						name: "shell.overlay",
						id: "cc-adr-panel",
						order: 250,
						label: "ADR panel",
						inject: function () {
							return {
								hooks: { panel: store },
								closePanel: function () {
									store.set({ open: false });
								},
								/**
								 * The row's two halves, injected as they are so the test that drives
								 * this bundle can substitute a transport: `ask` obtains the ratchet's
								 * question from the host route, `settle` returns the human's selected
								 * label to it paired with that question. Neither composes an answer —
								 * the label comes from the question itself, through
								 * `ratifyQuestionOf`.
								 */
								ask: askConsent,
								settle: settleConsent,
								load: function (signal) {
									return loadPanel(ctx, store.getSnapshot().sessionId, signal);
								}
							};
						}
					}, AdrPanelOverlay);
				});
			});
			ctx.effect(function () {
				return ctx.slots.inject("conversation.composer", function () {
					return ctx.slots.register({
						name: "conversation.composer",
						id: "cc-adr-panel",
						// The seat is a chain: the core keeps its entries sorted by ASCENDING
						// `priority` (lower tries first, ties keep registration order) and the first
						// entry whose `select` returns a value is elected. The entry that owns the
						// seat claims EVERY pending question at the default priority 0, so a claim
						// registered at 0 or above is never reached at all — it would look like a
						// working claim and be dead code, which is exactly what `priority: 1` here
						// was until the real SlotCore was driven: `user-questions@0` was elected over
						// `adr-panel@1` for a ratify question. The priority is therefore NEGATIVE, so
						// this entry is asked first and passes every question it does not recognise
						// on to the owner. Claiming here SUPPRESSES the harness's question card for
						// this question, which is the point: an agent's decision is answered in the
						// decision panel, and the Conversation gets a pointer rather than a quiz. A
						// question the ratchet sends without the panel intent — a grilling
						// session's — is not claimed, so it is asked, and blocks, in the
						// Conversation where the grill is.
						priority: -1,
						select: function (ownerProps) {
							var interaction = ownerProps === undefined || ownerProps === null ? null : ownerProps.pendingInteraction;
							return ratifyQuestionOf(interaction) === null ? null : interaction;
						},
						inject: function () {
							return {
								hooks: { panel: store },
								publishRatify: publishRatify,
								openPanel: openPanel
							};
						}
					}, RatifyComposer);
				});
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
