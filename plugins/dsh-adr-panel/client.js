/**
 * PURPOSE
 *   Browser half of the ADR panel: a Session-header button that opens a frame-wide
 *   overlay showing a project's decision corpus and its compiled specs as a
 *   readable, cross-linked view. It is a VIEWER: the ratchet CLI (`ratchet verify`)
 *   remains the authority on what is enforced, and every state it displays is read
 *   from the corpus files.
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
 *   registration's `inject` factory. Decision and spec text is read through
 *   `ctx.remote.workspaceFiles.list/read`, addressed by the Session id.
 *
 *   THE CONSENT ROUTE IS LEARNED AT MOUNT TIME, from the index global the host half
 *   writes: `globalThis.__DSH_ADR_PANEL_CONSENT__` carries the route path and this
 *   activation's capability token. The token is minted in the host process's memory,
 *   never written to a file and never logged, so no tool can read it; without the global
 *   the row falls back to naming the CLI command instead of offering a button. The
 *   request is an ordinary same-origin `fetch`, which carries the harness's
 *   browser-session cookie, and the host refuses anything that fails that fence or the
 *   token.
 *
 *   PROJECT-AGNOSTIC: the node that renders is discovered from the project itself, not
 *   hardcoded. `.dsh/project.json` is read once per load for `ratchet.decisionsDir`,
 *   `ratchet.specsDir` and `name`, falling back to `docs/adrs`, `docs/specs` and the
 *   first spec's `Project:` line when the manifest is absent, unparseable or silent.
 *   No zone name, law-id shape, file name beyond the `*.adr.md` / `*.spec.md` suffixes,
 *   or presence of any record is assumed.
 *
 *   A RECORD'S TEXT IS READ BYTE-EXACTLY, because a consent is a claim about an exact
 *   text. The workspace file API has two reads: a paged `read` that returns ONE PAGE of
 *   lines REBUILT by joining them with `\n`, and a whole-file `readAll` that returns the
 *   file's exact bytes as base64. The paged text is not the file's text: a file whose
 *   last line ends in a newline comes back without it (measured against the harness's
 *   own service: 8946 bytes on disk, 8945 returned). Hashing that reconstruction made a
 *   record whose last line ends in a plain LF hash to a value no ratification ever
 *   recorded, so every consent it carried read as unproven and a decision in force was
 *   displayed as `awaiting a human` — the exact class of wrong verdict this panel is
 *   forbidden to show. The whole-file read is therefore the ONLY source of a hash;
 *   where it is unavailable the record is left without one, which means "not proven"
 *   rather than "proven against a text nobody approved", and the reason is reported.
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
 *   and Consents (`type === "approval"`). There is exactly ONE force state: a record
 *   whose frontmatter says `active` and is permitted by its zones, and a record a PROVEN
 *   human consent put into force, both read `in force`. The panel derives that state the
 *   way the ratchet's `resolveActiveSet` does rather than from the frontmatter alone: a
 *   consent counts only when the approval is human-authored, its `ratification` block is
 *   well formed, it covers the record, and its recorded content hash still matches the
 *   file; an agent's `active` is force only under zones that resolve to
 *   `activeIfNoConflict`; a record declaring no zone is judged under the manifest's
 *   `defaultAgentAuthority` (or `proposeOnly` when that is absent), never treated as
 *   unrestricted; a `humanOnly` zone refuses even a ratified agent record; and a
 *   superseder retires a target only when it is itself in force and is human-authored or
 *   ratified. HOW a record entered force is a separate provenance pill — `ratified by
 *   <id>` (a link to the consent, success tone), `agent-activated` (in force on an
 *   agent's say-so, warn tone because no human has seen it) or `human-authored`
 *   (business tone). `awaiting a human`, `superseded by <id>`, `rejected` and
 *   `withdrawn` are states with no provenance pill. A state computed from another
 *   record rather than read from this record's frontmatter is rendered dashed/italic.
 *   The ratify affordance appears ONLY for a decision that is
 *   `type !== "approval"`, **agent-authored**, **not in force** (a `proposed` record, or
 *   an `active` one its zone refuses — the compiler's excluded set), named by no proven
 *   consent, **not retired by an in-force superseder**, and **not
 *   blocked** — blocked meaning the zone policy that governs it resolves to `humanOnly`,
 *   or it names a zone the manifest does not declare, where a consent cannot transfer
 *   authorship or make the question answerable. A
 *   human-authored proposed decision is never offered: its authorship already carries
 *   the authority, so it shows `not in force` and awaits its author's activation, not a
 *   question. A ratifiable decision's row carries **Approve** and **Decline**, and one
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
 *   ADR panel, decisions, consents, specs, law cards, check histogram, slots,
 *   shell.overlay, session header, conversation.composer, composer seat claim,
 *   presentation intent, workspace files, remote, ratification, approve, decline,
 *   consent route, capability token, not now, read-only, viewer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `ctx.remote.workspaceFiles` absent: the window still renders and shows that
 *     the file API is unreachable; the header button is unaffected.
 *   - The consent route unreachable — no host half mounted, no capability global, or no
 *     Session bound: the row names the CLI command instead of the two buttons, and
 *     nothing is sent anywhere.
 *   - A decision the ratchet's queue does not list — already in force, retired, a zone
 *     that is `humanOnly` or undeclared, or an id that is not a decision at all: the ask
 *     returns the ratchet's own message, the row shows it, and nothing is written. The
 *     ratchet is the authority on what may be ratified; the panel's own `canOfferRatify`
 *     is only what it renders from the corpus.
 *   - A question the panel cannot reduce to two labelled answers (`ratifyQuestionOf`
 *     returns `null` for the returned quiz): the row says it cannot put the question, and
 *     no label is sent.
 *   - The round trip's outcome is always shown: an approval names the approval id, its
 *     file and the transcript; a decline says the decision stays proposed and that
 *     nothing was written; a refusal shows the ratchet's own problem codes and messages;
 *     a transport failure shows the failure's message. No outcome leaves the row silent.
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
 *   - A directory or a single file that cannot be read: reported as a line, and the
 *     rest of the list still renders.
 *   - A record the whole-file read cannot serve — a harness whose file API has no
 *     `readAll`, a file above its cap, or bytes that do not decode: the paged read is
 *     used for the display text, the record is given NO content hash, and a line names
 *     the file and the reason. A consent that cannot be verified is reported as
 *     unverifiable rather than as unpaid, and is never inferred from a text that is not
 *     the file's own.
 *   - Frontmatter or a spec that does not parse: the record is listed with whatever
 *     parsed and a note; a field that did not parse renders as `unknown`, and parsing
 *     never throws.
 *   - A `decided in <id>` that names no decision in the corpus, or one whose state is
 *     not `in force`: the chip is rendered as plain text, is not clickable, and takes
 *     the neutral tone (unknown id) or the named decision's own state tone.
 *   - An author whose name and authority are the same word: the label collapses to that
 *     one word.
 *   - A section with nothing to show: a clean line naming the resolved directory, never
 *     a crash, and the header summary omits its zero count.
 *   - Window closed during a load: the AbortController cancels the reads and no state
 *     is written after unmount. A consent round trip already in flight is not cancelled;
 *     the ratchet either records it or not, and the row's next render reflects that.
 *   - No `.dsh/project.json`, an unparseable one, or one without
 *     `ratchet.decisionsDir`/`ratchet.specsDir`: the documented defaults are used, and an
 *     unparseable manifest is a non-fatal note rather than a failed load.
 *   - A project with no decision files or no specs (or no such directory): a clean empty
 *     line that names the resolved directory, never a crash.
 *   - The spec histogram counts fewer checks than the document declares: a warn line says
 *     so, because a parse gap must not render as an unlabelled segment.
 *   - A check whose parsed type is empty: its type pill renders `unknown` in the neutral
 *     tone, so a check row can never be a detail with no label.
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
		const PANEL_VERSION = "0.1.22";
		/** The manifest a ratchet project declares its directories and name in. */
		const MANIFEST_PATH = ".dsh/project.json";
		/** Directories used when the manifest is absent, unparseable, or silent. */
		const DEFAULT_DECISIONS_DIR = "docs/adrs";
		const DEFAULT_SPECS_DIR = "docs/specs";
		/**
		 * The three agent-authority policies the ratchet accepts, duplicated here because
		 * this browser closure cannot import the ratchet's own list. An unrecognised value
		 * is treated as no declaration at all, which is what the ratchet's manifest parser
		 * does when it drops a zone that declares one.
		 */
		const AGENT_AUTHORITY_POLICIES = ["humanOnly", "proposeOnly", "activeIfNoConflict"];
		/**
		 * The policy the ratchet applies when neither the zone nor the manifest declares
		 * one. The safe middle: an agent's own `active` is not force.
		 */
		const DEFAULT_AGENT_AUTHORITY = "proposeOnly";
		/**
		 * The channels a ratification can have been obtained through.
		 *
		 * Duplicated from the ratchet's `RATIFICATION_CHANNELS` for the same reason as
		 * `RATIFY_INTENT_KIND`: this bundle cannot import the ratchet's module. Both values
		 * are real, and the panel must know BOTH, because a consent it recorded itself
		 * carries `adr-panel` — a list missing it would make the panel report its own
		 * approval as unproven and keep offering the decision for ratification.
		 * `scripts/check-consent-surface.mjs` fails when the two lists stop being equal.
		 */
		const RATIFICATION_CHANNELS = ["user-question", "adr-panel"];
		/** The recorded form of a content hash, e.g. `sha256:<64 lowercase hex>`. */
		const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
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
		/** The page origin the route is fetched from; the corpus and the route share it. */
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
		 *
		 * OUTPUTS
		 *   A promise of the ratchet's own result plus `error` on a transport or host
		 *   refusal: `{ ok, ratified, rejected, unreadable, approval, transcript, wrote,
		 *   problems, error }`. Never rejects.
		 *
		 * KEYWORDS
		 *   consent route, settle, label, paired quiz, approval, transcript
		 */
		function settleConsent(adrId, label, quiz, sessionId) {
			var endpoint = consentEndpoint();
			if (endpoint === null) return Promise.resolve({ ok: false, error: "unreachable" });
			if (typeof adrId !== "string" || adrId === "") return Promise.resolve({ ok: false, error: "no-decision" });
			if (typeof label !== "string" || label === "") return Promise.resolve({ ok: false, error: "no-label" });
			if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no-session" });
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
					quiz: quiz === undefined ? null : quiz
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

		//#region frontmatter and body parsing
		/** @returns one top-level scalar's value, or null. */
		function scalar(lines, key) {
			var re = new RegExp("^" + key + ":[ \t]*(.*)$");
			for (var i = 0; i < lines.length; i += 1) {
				var match = lines[i].match(re);
				if (match !== null) return unquote(match[1]);
			}
			return null;
		}
		/** @returns one scalar nested under a mapping key (e.g. author.authority), or null. */
		function nestedScalar(lines, parent, key) {
			var re = new RegExp("^" + parent + ":");
			var nested = new RegExp("^[ \t]+" + key + ":[ \t]*(.*)$");
			for (var i = 0; i < lines.length; i += 1) {
				if (!re.test(lines[i])) continue;
				for (var j = i + 1; j < lines.length; j += 1) {
					if (/^[^\s]/.test(lines[j])) break;
					var match = lines[j].match(nested);
					if (match !== null) return unquote(match[1]);
				}
			}
			return null;
		}
		/**
		 * Read one YAML-style list: `key: []`, an inline FLOW sequence `[a, b]`, or a block
		 * of `- item` lines. Only the flat shapes this corpus uses are understood.
		 *
		 * A flow sequence is split into its entries rather than returned as one string,
		 * because the ratchet's own frontmatter reader (`scalar`) treats `[a, b]` as the
		 * array `[a, b]`. Returning the literal `"[a, b]"` made the panel read a different
		 * record than the host: an inline `zones: [zone-a]` resolved to one unknown zone
		 * instead of the declared one, and an inline `approves: [0001]` named no record.
		 *
		 * @returns an array of scalar strings; `[]` when the block is empty or absent.
		 */
		function listValues(lines, key) {
			var re = new RegExp("^" + key + ":[ \t]*(.*)$");
			for (var i = 0; i < lines.length; i += 1) {
				var match = lines[i].match(re);
				if (match === null) continue;
				var inline = unquote(match[1]);
				if (inline === "[]") return [];
				if (inline.charAt(0) === "[" && inline.charAt(inline.length - 1) === "]") {
					var inner = inline.slice(1, -1).trim();
					if (inner === "") return [];
					return inner.split(",").map(function (entry) {
						return unquote(entry);
					});
				}
				if (inline !== "") return [inline];
				var out = [];
				for (var j = i + 1; j < lines.length; j += 1) {
					if (/^[^\s]/.test(lines[j])) break;
					var item = lines[j].match(/^[ \t]+-[ \t]*(.*)$/);
					if (item !== null) out.push(unquote(item[1]));
				}
				return out;
			}
			return [];
		}
		/**
		 * Split a record into its frontmatter lines and its markdown body.
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
		/** @returns the scalar with surrounding single or double quotes removed. */
		function unquote(value) {
			var v = String(value == null ? "" : value).trim();
			if (v.length >= 2 && ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'"))) {
				return v.slice(1, -1);
			}
			return v;
		}
		/** @returns the ids in the record's `laws:` block, or [] when it declares none. */
		function lawIds(lines) {
			for (var i = 0; i < lines.length; i += 1) {
				if (/^laws:[ \t]*\[\][ \t]*$/.test(lines[i])) return [];
				if (/^laws:[ \t]*$/.test(lines[i])) {
					var ids = [];
					for (var j = i + 1; j < lines.length; j += 1) {
						if (/^[^\s]/.test(lines[j])) break;
						var match = lines[j].match(/^[ \t]+(?:-[ \t]+)?id:[ \t]*(.*)$/);
						if (match !== null) ids.push(unquote(match[1]));
					}
					return ids;
				}
			}
			return [];
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
		/** @returns the section's lines flattened into one line of prose. */
		function plainText(lines) {
			var out = [];
			for (var i = 0; i < lines.length; i += 1) {
				var line = String(lines[i]).replace(/^\s*[-*][ \t]+/, "").replace(/^\s*#{1,6}[ \t]+/, "").trim();
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
		 * Normalise the line endings and the byte-order mark of a file the panel reads.
		 *
		 * Both parsers below are line-oriented and several of their patterns end in `$`,
		 * while `.` never matches `\r` — so on a checkout whose working tree holds CRLF
		 * (Windows, where `.gitattributes` leaves `.md` to the platform) `## <law id>` and
		 * the other anchored patterns match nothing, and a spec renders as a document with
		 * zero laws rather than as an error. Normalising at the single point where text
		 * enters the panel makes the two parsers independent of how git checked the corpus
		 * out, which is what "the panel shows what the record says" has to mean.
		 *
		 * @param value - The text as the host returned it, or anything else.
		 * @returns The text with a leading BOM removed and every CRLF/CR replaced by LF.
		 *   Non-string input becomes the empty string.
		 */
		function normaliseText(value) {
			return String(value == null ? "" : value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
		}
		/**
		 * PURPOSE
		 *   Compute the sha256 of a record's text in exactly the form the ratchet's
		 *   `hashSource` records, so a ratification's `contentHash` can be compared with
		 *   the text now in the file. Without this the panel could only check that a block
		 *   exists, and would report "in force" for a consent the record has since been
		 *   edited out from under — which is the stale-consent case the host refuses.
		 *
		 * INPUTS
		 *   text - The record's WHOLE-FILE text as {@link readRecordText} returned it
		 *     (already normalised there). A text that is only a page of the file is not
		 *     this record's text and must not be hashed: see `readRecordText`. Any
		 *     non-string is treated as the empty string.
		 *
		 * OUTPUTS
		 *   A promise for `sha256:<64 lowercase hex>`, or `null` when the platform exposes
		 *   no `crypto.subtle` or no `TextEncoder`, and on any digest failure. A hash that
		 *   cannot be computed proves nothing, and the caller treats `null` as no consent.
		 *
		 * KEYWORDS
		 *   content hash, sha256, webcrypto, ratification, stale consent, approval
		 */
		function contentHashOf(text) {
			try {
				if (typeof TextEncoder !== "function") return Promise.resolve(null);
				if (typeof crypto === "undefined" || crypto === null || crypto.subtle === undefined || typeof crypto.subtle.digest !== "function") {
					return Promise.resolve(null);
				}
				var bytes = new TextEncoder().encode(normaliseText(text));
				return crypto.subtle.digest("SHA-256", bytes).then(function (buffer) {
					var view = new Uint8Array(buffer);
					var hex = "";
					for (var i = 0; i < view.length; i += 1) {
						var part = view[i].toString(16);
						hex += part.length === 1 ? "0" + part : part;
					}
					return "sha256:" + hex;
				}, function () {
					return null;
				});
			} catch (error) {
				return Promise.resolve(null);
			}
		}
		/**
		 * PURPOSE
		 *   Read and validate an approval record's `ratification` block, mirroring the
		 *   ratchet's own `readRatification`: the channel, the moment, who asked, and one
		 *   content hash per approved record. An approval with no block, or one whose shape
		 *   is malformed, proves nothing, and the force model must see it as proving
		 *   nothing rather than trust the `approves` list on its own.
		 *
		 * INPUTS
		 *   lines - the record's frontmatter lines, as split by `splitFrontmatter`.
		 *
		 * OUTPUTS
		 *   `{ channel, at, askedBy, targets: [{ id, contentHash }] }` when the block is
		 *   present and well formed, or `null` in every other case: absent, an empty
		 *   mapping, a channel outside `RATIFICATION_CHANNELS`, a missing/blank `at` or
		 *   `askedBy`, an empty `targets` list, a target without an id, a duplicated id, a
		 *   content hash that is not `sha256:<64 hex>`, or any line inside the block that
		 *   this strict reader cannot place. The caller decides whether the target it
		 *   cares about is covered; a block that covers other records is still well formed.
		 *
		 * KEYWORDS
		 *   ratification, content hash, consent validity, approval, unproven, frontmatter
		 */
		function parseRatification(lines) {
			var start = -1;
			for (var i = 0; i < lines.length; i += 1) {
				if (/^ratification:[ \t]*$/.test(lines[i])) { start = i; break; }
				if (/^ratification:[ \t]*\S/.test(lines[i])) return null;
			}
			if (start === -1) return null;
			var channel = null;
			var at = null;
			var askedBy = null;
			var targets = [];
			var current = null;
			var inTargets = false;
			for (var j = start + 1; j < lines.length; j += 1) {
				var line = lines[j];
				if (/^[^\s]/.test(line)) break;
				if (/^[ \t]*(#.*)?$/.test(line)) continue;
				if (/^[ \t]+targets:[ \t]*$/.test(line)) { inTargets = true; current = null; continue; }
				if (inTargets) {
					var idMatch = line.match(/^[ \t]+-[ \t]*id:[ \t]*(.*)$/);
					if (idMatch !== null) {
						current = { id: unquote(idMatch[1]), contentHash: null };
						targets.push(current);
						continue;
					}
					var hashMatch = line.match(/^[ \t]+contentHash:[ \t]*(.*)$/);
					if (hashMatch !== null && current !== null) { current.contentHash = unquote(hashMatch[1]); continue; }
					return null;
				}
				var field = line.match(/^[ \t]+([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/);
				if (field === null) return null;
				if (field[1] === "channel") channel = unquote(field[2]);
				else if (field[1] === "at") at = unquote(field[2]);
				else if (field[1] === "askedBy") askedBy = unquote(field[2]);
			}
			if (channel === null || RATIFICATION_CHANNELS.indexOf(channel) === -1) return null;
			if (at === null || at.trim() === "" || askedBy === null || askedBy.trim() === "") return null;
			if (targets.length === 0) return null;
			var seen = Object.create(null);
			for (var k = 0; k < targets.length; k += 1) {
				var target = targets[k];
				if (typeof target.id !== "string" || target.id.trim() === "") return null;
				if (seen[target.id] === true) return null;
				seen[target.id] = true;
				if (typeof target.contentHash !== "string" || !CONTENT_HASH_PATTERN.test(target.contentHash)) return null;
			}
			return { channel: channel, at: at, askedBy: askedBy, targets: targets };
		}
		/**
		 * Parse one ADR file into the fields the panel shows. Every field that does not
		 * parse stays null (or []) and is rendered as `unknown`; nothing is invented.
		 * @param item - `{ name, path, text }` read from `docs/adrs`.
		 * @returns the parsed record; `error` carries a reason when the file failed.
		 *   `ratification` is the validated block for an approval record and null
		 *   otherwise; `contentHash` is filled by the caller once the file's sha256 is
		 *   computed, so it is null here.
		 */
		function parseAdr(item) {
			var record = {
				id: null, title: item.name, type: null, status: null, authority: null, authorName: null,
				created: null, sourcePath: null, sourceHash: null, ratificationAt: null, ratification: null,
				contentHash: null, zones: [], supersedes: [],
				approves: [], laws: [], body: "", sections: [], path: item.path, error: null
			};
			try {
				var split = splitFrontmatter(item.text);
				if (split === null) {
					record.error = "no frontmatter block";
					return record;
				}
				var lines = split.lines;
				record.id = scalar(lines, "id");
				record.title = scalar(lines, "title") || item.name;
				record.type = scalar(lines, "type");
				record.status = scalar(lines, "status");
				record.authority = nestedScalar(lines, "author", "authority");
				record.authorName = nestedScalar(lines, "author", "name");
				record.created = scalar(lines, "created");
				record.sourcePath = nestedScalar(lines, "source", "path");
				record.sourceHash = nestedScalar(lines, "source", "hash");
				record.ratificationAt = nestedScalar(lines, "ratification", "at");
				record.ratification = record.type === "approval" ? parseRatification(lines) : null;
				record.zones = listValues(lines, "zones");
				record.supersedes = listValues(lines, "supersedes");
				record.approves = listValues(lines, "approves");
				record.laws = lawIds(lines);
				record.body = split.body;
				record.sections = bodySections(split.body);
			} catch (error) {
				record.error = describeError(error);
			}
			return record;
		}
		/**
		 * Parse one compiled spec document into its laws and checks.
		 *
		 * The shape is regular: an HTML comment carrying the spec hash, `# Spec: <zone>`,
		 * `Project: <name>`, then one `## <law id>` block per law with a statement, a
		 * `- authority:` line, a `- decided in: <adr>` line, and a `- checks:` list.
		 *
		 * @param item - `{ name, path, text, eof }` read from `docs/specs`.
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
						law = { id: heading[1].trim(), statement: "", authority: null, decidedIn: null, approvedBy: null, checks: [] };
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

		//#region derived state and cross-references
		/**
		 * PURPOSE
		 *   Resolve the manifest's zone policy the way the ratchet's own manifest parser
		 *   does, so every authority judgement the panel makes uses the same default and
		 *   the same per-zone override the host would apply. The force model cannot be
		 *   re-derived from a zone id alone: a zone that omits `agentAuthority` inherits
		 *   the manifest default, and a record that declares no zone is governed by that
		 *   default under the synthetic id `(unzoned)`.
		 *
		 * INPUTS
		 *   manifest - the parsed `.dsh/project.json`, or null when there is none.
		 *
		 * OUTPUTS
		 *   `{ zones, defaultAuthority }`. `zones` is a null-prototype map from a declared
		 *   zone id to its resolved `agentAuthority`; a zone the manifest does not declare
		 *   is absent, and a zone whose `agentAuthority` is present but not one of
		 *   `AGENT_AUTHORITY_POLICIES` is dropped (the ratchet drops it too, with a
		 *   ZONE_INVALID problem, and then treats the zone as undeclared). `defaultAuthority`
		 *   is the manifest's `ratchet.defaultAgentAuthority` when it is a valid policy and
		 *   `DEFAULT_AGENT_AUTHORITY` otherwise, which is the ratchet's own constant default
		 *   rather than "no authority at all". Never throws on a null or malformed manifest.
		 *
		 * KEYWORDS
		 *   manifest, zone, agentAuthority, defaultAgentAuthority, proposeOnly, humanOnly,
		 *   activeIfNoConflict, policy resolution, force model
		 */
		function resolveZonePolicy(manifest) {
			var ratchet = manifest !== null && typeof manifest === "object" ? manifest.ratchet : null;
			var section = ratchet !== null && typeof ratchet === "object" ? ratchet : {};
			var declaredDefault = section.defaultAgentAuthority;
			var defaultAuthority = typeof declaredDefault === "string" && AGENT_AUTHORITY_POLICIES.indexOf(declaredDefault) !== -1 ? declaredDefault : DEFAULT_AGENT_AUTHORITY;
			var zones = Object.create(null);
			var list = Array.isArray(section.zones) ? section.zones : [];
			for (var i = 0; i < list.length; i += 1) {
				var zone = list[i];
				if (zone === null || typeof zone !== "object") continue;
				if (typeof zone.id !== "string" || zone.id === "") continue;
				if (zone.agentAuthority !== undefined && AGENT_AUTHORITY_POLICIES.indexOf(zone.agentAuthority) === -1) continue;
				zones[zone.id] = zone.agentAuthority === undefined ? defaultAuthority : zone.agentAuthority;
			}
			return { zones: zones, defaultAuthority: defaultAuthority };
		}
		/**
		 * PURPOSE
		 *   Resolve the zones whose policy governs one record, mirroring the ratchet's
		 *   `zonesForRecord`: a record declaring no zone is governed by the manifest default
		 *   under the synthetic id `(unzoned)`; a declared zone the manifest carries is
		 *   governed by its own resolved policy; a declared zone it does not carry is
		 *   governed by the default and marked `missing`, so an unknown zone narrows rather
		 *   than widens authority.
		 *
		 * INPUTS
		 *   record - a parsed record (only `zones` is read).
		 *   zonePolicy - `{ zones, defaultAuthority }` from {@link resolveZonePolicy}; null
		 *     is treated as an empty policy with the constant default.
		 *
		 * OUTPUTS
		 *   An array of `{ id, authority, missing? }`, never empty. `missing` is present and
		 *   true only for a declared zone the manifest does not carry.
		 *
		 * KEYWORDS
		 *   zone resolution, unzoned, missing zone, authority, force model
		 */
		function governingZones(record, zonePolicy) {
			var defaultAuthority = zonePolicy === undefined || zonePolicy === null || typeof zonePolicy.defaultAuthority !== "string" ? DEFAULT_AGENT_AUTHORITY : zonePolicy.defaultAuthority;
			var declared = Array.isArray(record.zones) ? record.zones : [];
			if (declared.length === 0) return [{ id: "(unzoned)", authority: defaultAuthority }];
			var known = zonePolicy !== undefined && zonePolicy !== null && zonePolicy.zones !== undefined && zonePolicy.zones !== null ? zonePolicy.zones : Object.create(null);
			return declared.map(function (zoneId) {
				var authority = known[zoneId];
				return authority === undefined
					? { id: zoneId, authority: defaultAuthority, missing: true }
					: { id: zoneId, authority: authority };
			});
		}
		/**
		 * PURPOSE
		 *   Decide whether a record's own `status: active` may put it into force without a
		 *   consent, mirroring the ratchet's `selfActivationPermitted`: a human-authored
		 *   record may, and an agent-authored one may only when every zone it names
		 *   declares `activeIfNoConflict`.
		 *
		 * INPUTS
		 *   record - a parsed record.
		 *   zonePolicy - `{ zones, defaultAuthority }`.
		 *
		 * OUTPUTS
		 *   `true` when the record may self-activate, `false` otherwise. A record naming no
		 *   zone is judged under the manifest default, so it cannot escape regulation by
		 *   staying unzoned.
		 *
		 * KEYWORDS
		 *   self activation, activeIfNoConflict, zone authority, force model
		 */
		function selfActivationPermitted(record, zonePolicy) {
			if (record.authority !== "agent") return true;
			return governingZones(record, zonePolicy).every(function (zone) {
				return zone.authority === "activeIfNoConflict";
			});
		}
		/** @returns the ratification target entry for `id`, or null when the block omits it. */
		function consentTarget(ratification, id) {
			for (var i = 0; i < ratification.targets.length; i += 1) {
				if (ratification.targets[i].id === id) return ratification.targets[i];
			}
			return null;
		}
		/**
		 * PURPOSE
		 *   Build the whole-corpus relation maps a viewer needs: which records a VALID human
		 *   consent puts into force, and which records an in-force superseder retires. Both
		 *   are read from the files, never inferred from a status field, because a status
		 *   field an agent can write is exactly what the gate exists to check.
		 *
		 * INPUTS
		 *   adrs - every parsed record. Each carries `ratification` (the validated block, or
		 *     null) and `contentHash` (the file's sha256, or null when it could not be
		 *     computed).
		 *   zonePolicy - `{ zones, defaultAuthority }`, needed because supersession and
		 *     consent refusal both turn on a record's zone authority.
		 *
		 * OUTPUTS
		 *   `{ approvedBy, supersededBy }`, both null-prototype maps of arrays.
		 *   `approvedBy` maps a decision id to the ids of the approvals that PROVE a consent
		 *   for it: the approval is human-authored, its ratification block is well formed and
		 *   covers the decision, and the recorded content hash still equals the file's hash.
		 *   An approval missing any of those proves nothing and is absent, which is what makes
		 *   this the consent map rather than a list of `approves` claims.
		 *   `supersededBy` maps a retired id to the id of the in-force record that retires it,
		 *   and is empty for a superseder that is withdrawn, refused by its zone, or not
		 *   authorised to retire that target (mirroring LAW_REMOVE_UNAUTHORISED). A record
		 *   with a null id can neither approve nor supersede.
		 *
		 * KEYWORDS
		 *   relations, consent map, content hash, staleness, supersession, in force,
		 *   ratification, LAW_REMOVE_UNAUTHORISED
		 */
		function buildRelations(adrs, zonePolicy) {
			// PROTOTYPE-LESS maps. A record id or an approved/superseded id is read from a file, so it
			// can be `constructor`, `__proto__` or any other Object member: a plain `{}` then answers
			// an inherited function where the code expects an array, and the guards `!== undefined`
			// and `.length` both pass before `.join`/`.push` throws. ONE such id made the whole
			// corpus vanish behind "the panel could not load". A null-prototype object has no
			// inherited members to collide with.
			var byId = Object.create(null);
			for (var b = 0; b < adrs.length; b += 1) {
				if (adrs[b].id !== null && adrs[b].id !== "") byId[adrs[b].id] = adrs[b];
			}
			var approvedBy = Object.create(null);
			var consentOf = Object.create(null);
			for (var i = 0; i < adrs.length; i += 1) {
				var approval = adrs[i];
				if (approval.type !== "approval") continue;
				if (approval.authority !== "human") continue;
				if (approval.ratification === null) continue;
				if (approval.id === null || approval.id === "") continue;
				for (var a = 0; a < approval.approves.length; a += 1) {
					var approved = approval.approves[a];
					var target = byId[approved];
					if (target === undefined) continue;
					var entry = consentTarget(approval.ratification, approved);
					if (entry === null) continue;
					if (entry.contentHash !== target.contentHash) continue;
					if (approvedBy[approved] === undefined) approvedBy[approved] = [];
					approvedBy[approved].push(approval.id);
					consentOf[approved] = approval.id;
				}
			}
			// Consent does not transfer authorship: an agent record in a humanOnly zone is refused
			// even when ratified, and it cannot then retire anything (the ratchet's `refusedConsent`).
			var refusedConsent = Object.create(null);
			for (var r = 0; r < adrs.length; r += 1) {
				var ratified = adrs[r];
				if (ratified.id === null || ratified.id === "" || consentOf[ratified.id] === undefined) continue;
				if (ratified.authority !== "agent") continue;
				if (governingZones(ratified, zonePolicy).some(function (zone) { return zone.authority === "humanOnly"; })) refusedConsent[ratified.id] = true;
			}
			var candidates = [];
			for (var c = 0; c < adrs.length; c += 1) {
				var superseder = adrs[c];
				if (superseder.type === "approval") continue;
				var hasConsent = superseder.id !== null && superseder.id !== "" && consentOf[superseder.id] !== undefined && refusedConsent[superseder.id] !== true;
				if (hasConsent || (superseder.status === "active" && selfActivationPermitted(superseder, zonePolicy))) candidates.push(superseder);
			}
			var supersededBy = Object.create(null);
			for (var s = 0; s < candidates.length; s += 1) {
				var retiring = candidates[s];
				for (var t = 0; t < retiring.supersedes.length; t += 1) {
					var targetId = retiring.supersedes[t];
					if (supersededBy[targetId] !== undefined) continue;
					var targetRecord = byId[targetId];
					// A supersession must meet the same authority bar as an explicit law removal.
					var authorised = retiring.authority === "human" || (retiring.id !== null && consentOf[retiring.id] !== undefined);
					if (!authorised && targetRecord !== undefined && (targetRecord.authority === "human" || consentOf[targetRecord.id] !== undefined)) continue;
					supersededBy[targetId] = [retiring.id];
				}
			}
			return { approvedBy: approvedBy, supersededBy: supersededBy };
		}
		/**
		 * The state a decision is displayed with, in fixed precedence, and the separate
		 * provenance of its force.
		 *
		 * There is exactly ONE force state. A record whose own `status: active` is permitted
		 * by its zones and a record put into force by a valid human consent are both `in
		 * force`; they differ only in provenance, which is a second pill: `ratified by
		 * <id>` (a human consented), `agent-activated` (in force on an agent's say-so,
		 * rendered as attention rather than failure) or `human-authored`. A proposed record
		 * no valid consent names is `awaiting a human` and carries no provenance pill.
		 * Supersession, rejection and withdrawal are states with no provenance.
		 *
		 * This mirrors the host's `resolveActiveSet` rule for rule rather than reading the
		 * frontmatter alone: a consent counts only when the approval that carries it is
		 * human-authored, proves its ratification, and still matches the record's hash; an
		 * agent's `active` is force only in a zone whose resolved authority permits it; a
		 * record declaring no zone is judged under the manifest default (never treated as
		 * unrestricted); and a consent that a `humanOnly` zone refuses is not force.
		 *
		 * @param record - a parsed decision.
		 * @param relations - `{ approvedBy, supersededBy }`, where `approvedBy` holds only
		 *   PROVEN consents.
		 * @param zonePolicy - `{ zones, defaultAuthority }` from {@link resolveZonePolicy}.
		 * @returns `{ state, provenance }`. `state` is `{ text, kind, derived }`, where
		 *   `derived` marks a value computed from another record rather than read from this
		 *   one's frontmatter. `provenance` is `{ text, kind, link }` or null, where `link`
		 *   names the consent record a `ratified by` pill may select.
		 */
		function displayedState(record, relations, zonePolicy) {
			var approvals = record.id === null ? undefined : relations.approvedBy[record.id];
			var consent = approvals !== undefined && approvals.length > 0 ? approvals[0] : null;
			var superseded = record.id === null ? undefined : relations.supersededBy[record.id];
			if (superseded !== undefined && superseded.length > 0) {
				return { state: { text: "superseded by " + superseded.join(", "), kind: "superseded", derived: true }, provenance: null };
			}
			if (record.status === "rejected" || record.status === "withdrawn") {
				return { state: { text: record.status, kind: stateKindOfStatus(record.status), derived: false }, provenance: null };
			}
			var zones = governingZones(record, zonePolicy);
			var humanOnly = record.authority === "agent" && zones.some(function (zone) { return zone.authority === "humanOnly"; });
			// Consent does not transfer authorship: a humanOnly zone refuses a ratified agent
			// record exactly as it refuses an unratified one, so the consent is not force there.
			var effectiveConsent = humanOnly ? null : consent;
			var selfAuthorised = record.status === "active";
			if (record.authority === "agent") {
				// An agent's `active` is not force in a proposeOnly zone (until ratified) and is
				// never force in a humanOnly zone. A human-authored record self-activates.
				var proposeOnly = record.status === "active" && consent === null && zones.some(function (zone) { return zone.authority === "proposeOnly"; });
				if (humanOnly || proposeOnly) selfAuthorised = false;
			}
			if (selfAuthorised || effectiveConsent !== null) {
				var provenance = null;
				if (effectiveConsent !== null) provenance = { text: "ratified by " + effectiveConsent, kind: "ratified", link: [effectiveConsent] };
				else if (record.authority === "human") provenance = { text: "human-authored", kind: "human", link: null };
				else if (record.authority === "agent") provenance = { text: "agent-activated", kind: "pending", link: null };
				return {
					state: { text: "in force", kind: "in-force", derived: !(record.status === "active") },
					provenance: provenance
				};
			}
			if (record.status === "proposed") {
				// Only an AGENT's decision needs approval. A human-authored record carries its
				// own authority, so it is not "awaiting a human" — it awaits its author's own
				// activation, and labelling it as a call to consent contradicted the author
				// chip beside it. A blocked agent record is named as blocked rather than
				// offered, because the ratchet would refuse the question.
				if (record.authority === "agent") {
					var blocked = blockedReason(record, zonePolicy);
					if (blocked !== null) {
						return { state: { text: "blocked \u2014 " + blocked, kind: "neutral", derived: false }, provenance: null };
					}
					return { state: { text: "awaiting a human", kind: "pending", derived: false }, provenance: null };
				}
				return { state: { text: "not in force", kind: "neutral", derived: false }, provenance: null };
			}
			if (record.status === "active") {
				// Only an agent record reaches here: a human-authored `active` always self-activates.
				var why = blockedReason(record, zonePolicy);
				if (why !== null) {
					return { state: { text: "blocked \u2014 " + why, kind: "neutral", derived: false }, provenance: null };
				}
				var refusedZone = zones.filter(function (zone) { return zone.authority === "proposeOnly"; })[0];
				return { state: { text: "not in force \u2014 zone \"" + (refusedZone === undefined ? "(unzoned)" : refusedZone.id) + "\" needs a human ratification", kind: "pending", derived: false }, provenance: null };
			}
			var unknown = record.status === null || record.status === "" ? "unknown" : record.status;
			return { state: { text: unknown, kind: stateKindOfStatus(unknown), derived: false }, provenance: null };
		}
		/**
		 * PURPOSE
		 *   Why the ratchet could not put this decision to a human, or null. Mirrors the
		 *   ratchet's `ratificationQueue`: a zone that reserves its paths to a human is
		 *   checked first (a ratified agent record is still agent-authored), then a zone the
		 *   manifest does not declare. Only an agent-authored record is ever blocked,
		 *   because authorship already carries the authority a consent would grant.
		 *
		 * INPUTS
		 *   record - a parsed record.
		 *   zonePolicy - `{ zones, defaultAuthority }` from {@link resolveZonePolicy}.
		 *
		 * OUTPUTS
		 *   A one-line reason, or null when the record is not blocked. A record that
		 *   declares no zone is judged under the manifest default, so an unzoned agent
		 *   record in a `humanOnly` default project is blocked under `(unzoned)`.
		 *
		 * KEYWORDS
		 *   ratification queue, blocked, humanOnly, missing zone, unzoned, consent
		 */
		function blockedReason(record, zonePolicy) {
			if (record.authority !== "agent") return null;
			var zones = governingZones(record, zonePolicy);
			var humanOnly = zones.filter(function (zone) { return zone.authority === "humanOnly"; });
			if (humanOnly.length > 0) {
				return "zone \"" + humanOnly[0].id + "\" reserves its paths to a human, so this needs a human author";
			}
			var undeclared = zones.filter(function (zone) { return zone.missing === true; });
			if (undeclared.length > 0) {
				return "zone \"" + undeclared[0].id + "\" is not declared in the manifest";
			}
			return null;
		}
		/**
		 * Whether the ratify affordance may be offered for a record.
		 *
		 * ONLY AN AGENT'S DECISION THAT IS NOT IN FORCE IS OFFERED, which is what the
		 * ratchet's queue lists: a `proposed` record, or an `active` one its zone refuses
		 * (the compiler's `excluded`, which a human "yes" may turn into force). A
		 * human-authored record already carries its own authority, so asking a human to
		 * approve it proposes a consent to the person who wrote the decision — the
		 * contradiction of an "awaiting a human" state beside a human author chip. Such a
		 * record awaits activation by its author instead. Among agent decisions, one the
		 * ratchet would refuse is not offered either: a BLOCKED record (a zone that resolves
		 * to `humanOnly`, or a zone the manifest does not declare) could not enter force on
		 * a "yes", so the affordance is withheld and the state names the reason. A record an
		 * in-force superseder retired is not offered either, because the ratchet's queue
		 * never lists one: ratifying it would resurrect a retired decision.
		 *
		 * The condition is the ratchet's own, read from the manifest, so the panel cannot
		 * offer an action the ratchet would reject or hide one it would accept.
		 *
		 * @param record - a parsed record.
		 * @param relations - `{ approvedBy, supersededBy }`.
		 * @param zonePolicy - `{ zones, defaultAuthority }` from {@link resolveZonePolicy}.
		 * @returns true only when the record is an agent's decision the ratchet can put to
		 *   the human.
		 */
		function canOfferRatify(record, relations, zonePolicy) {
			if (record.type === "approval") return false;
			if (record.authority !== "agent") return false;
			if (record.status !== "proposed" && record.status !== "active") return false;
			var approvals = record.id === null ? undefined : relations.approvedBy[record.id];
			if (approvals !== undefined && approvals.length > 0) return false;
			var superseded = record.id === null ? undefined : relations.supersededBy[record.id];
			if (superseded !== undefined && superseded.length > 0) return false;
			if (blockedReason(record, zonePolicy) !== null) return false;
			// An agent's `active` is already force where its zones permit it; only the excluded
			// case — an active record a `proposeOnly` zone withholds — is still offered.
			return !(record.status === "active" && selfActivationPermitted(record, zonePolicy));
		}
		/**
		 * Index the compiled laws by the decision that decided them, so the decision view
		 * and the spec view agree: the same `- decided in:` line produces both.
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
		/** @returns the one-line summary of a decision: Decision's first sentence, else Context's. */
		function decisionSummary(record) {
			var section = findSection(record.sections, "Decision") || findSection(record.sections, "Context");
			var text = section === null ? "" : plainText(section.lines);
			if (text === "") text = firstParagraph(record.body);
			return truncate(firstSentence(text), 140);
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
		/** @returns a hash shortened for display, e.g. `sha256:9a3f9532…`. */
		function shortHash(hash) {
			var value = String(hash == null ? "" : hash);
			if (value.length <= 20) return value === "" ? "unknown" : value;
			var parts = value.indexOf(":") === -1 ? [value] : [value.slice(0, value.indexOf(":") + 1), value.slice(value.indexOf(":") + 1)];
			if (parts.length === 1) return parts[0].slice(0, 8) + "…";
			return parts[0] + parts[1].slice(0, 8) + "…";
		}
		/** @returns the date part of an ISO timestamp, or the value as written when it does not parse. */
		function recordedDate(value) {
			var text = String(value == null ? "" : value);
			var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
			return match === null ? text : match[1];
		}
		//#endregion

		//#region reading
		/** @returns a manifest directory string with trailing slashes removed, or null when absent or blank. */
		function dirValue(value) {
			return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\/+$/, "") : null;
		}
		/**
		 * Read and parse the project manifest, when the project has one.
		 *
		 * A missing manifest is normal — the documented defaults apply — while one that
		 * cannot be parsed is a non-fatal note, because the panel has to keep working on
		 * the defaults rather than fail the whole load.
		 * @returns a promise for `{ manifest, note }` where `note` is null or one message;
		 *   never rejects.
		 */
		function readManifest(files, sessionId, signal) {
			return files.read(sessionId, MANIFEST_PATH, {}, signal).then(function (read) {
				if (read === undefined || read === null || read.ok !== true) return { manifest: null, note: null };
				var text = String(read.value && read.value.text ? read.value.text : "");
				try {
					return { manifest: JSON.parse(text), note: null };
				} catch (error) {
					return { manifest: null, note: MANIFEST_PATH + " could not be parsed (" + describeError(error) + "); the default directories are used" };
				}
			}, function () {
				return { manifest: null, note: null };
			});
		}
		/**
		 * The directories a ratchet project declares, falling back to the documented
		 * defaults. Resolved from the manifest so the panel works in any project rather
		 * than only in the one it was written in.
		 * @returns `{ decisionsDir, specsDir }`, both non-empty and without a trailing slash.
		 */
		function resolveDirs(manifest) {
			var ratchet = manifest !== null && typeof manifest === "object" ? manifest.ratchet : null;
			var section = ratchet !== null && typeof ratchet === "object" ? ratchet : {};
			var decisions = dirValue(section.decisionsDir);
			var specs = dirValue(section.specsDir);
			return {
				decisionsDir: decisions === null ? DEFAULT_DECISIONS_DIR : decisions,
				specsDir: specs === null ? DEFAULT_SPECS_DIR : specs
			};
		}
		/**
		 * The project's own name: the manifest's `name`, else the first spec's `Project:`
		 * line, else a neutral placeholder. Never a hardcoded repository name.
		 * @returns a non-empty display string.
		 */
		function projectNameOf(manifest, specs) {
			var named = manifest !== null && typeof manifest === "object" && typeof manifest.name === "string" ? manifest.name.trim() : "";
			if (named !== "") return named;
			for (var i = 0; i < specs.length; i += 1) {
				var specProject = specs[i].project;
				if (typeof specProject === "string" && specProject.trim() !== "") return specProject.trim();
			}
			return "this project";
		}
		/**
		 * Decode the base64 payload a whole-file read returns.
		 *
		 * The workspace file API's `readAll` answers with the file's exact bytes encoded
		 * as base64, because the wire carries text. Decoding here — rather than hashing
		 * the base64 — is what makes the result comparable with a ratification's
		 * `contentHash`, which the ratchet computed over the file's decoded text.
		 *
		 * INPUTS
		 *   data - the base64 string (`readAll`'s `value.data`), or any value.
		 *
		 * OUTPUTS
		 *   The decoded text, or `null` when the platform exposes no `atob` or no
		 *   `TextDecoder`, when the payload is not valid base64, or when `data` is not a
		 *   string. An empty payload decodes to the empty string — a real (if useless)
		 *   file — and is not confused with a failure, which is `null`.
		 *
		 * KEYWORDS
		 *   base64, utf-8, text decoder, whole-file read, content hash
		 */
		function decodeBase64Utf8(data) {
			if (typeof data !== "string") return null;
			if (typeof atob !== "function" || typeof TextDecoder !== "function") return null;
			try {
				var binary = atob(data);
				var bytes = new Uint8Array(binary.length);
				for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
				return new TextDecoder("utf-8").decode(bytes);
			} catch (error) {
				return null;
			}
		}
		/**
		 * PURPOSE
		 *   Read one record's text in the form that can be hashed the way the ratchet
		 *   hashed it. A consent binds one content hash to one exact text, so the panel
		 *   must hash the file's bytes and never a reconstruction of them: the paged
		 *   `read` rebuilds the text by joining the file's lines with `\n`, which DROPS a
		 *   final newline, and a record whose last line ends in a plain LF then hashes to
		 *   a value no ratification recorded — so a decision a human ratified is shown as
		 *   awaiting a human. The whole-file `readAll` returns the file's exact bytes.
		 *
		 * INPUTS
		 *   files - the workspace-files Remote. `readAll` is used when it is a function;
		 *   `read` is the fallback.
		 *   sessionId - the Session whose workspace root resolves the path.
		 *   path - the file's path, as `readDirectory` composed it.
		 *   signal - the caller's AbortSignal, or undefined.
		 *   failures - the shared failure list. A fallback appends one line, because a
		 *   text that is not byte-exact cannot verify a consent and saying so is the only
		 *   honest alternative to reporting the decision as unpaid.
		 *
		 * OUTPUTS
		 *   A promise for `{ text, exact, eof }`, or `null` when nothing could be read.
		 *   `text` is normalised for display and parsing; `exact` is true ONLY when it is
		 *   the file's decoded whole bytes, and the caller computes a content hash ONLY
		 *   then. `eof` is false when the fallback served a first page that does not reach
		 *   the end. Never rejects: every failure becomes a line in `failures` and a
		 *   `null` (or a page-based record), so the rest of the corpus still renders.
		 *
		 * KEYWORDS
		 *   whole-file read, readAll, base64, content hash, trailing newline, page fallback
		 */
		function readRecordText(files, sessionId, path, signal, failures) {
			var fromPage = function (reason) {
				return files.read(sessionId, path, {}, signal).then(function (read) {
					if (read === undefined || read === null || read.ok !== true) {
						failures.push(path + ": " + describeError(read && read.error));
						return null;
					}
					var eof = read.value ? read.value.eof !== false : true;
					if (eof === false) failures.push(path + ": only the first page was read, so the panel may be incomplete");
					failures.push(path + ": read only as a page (" + reason + "), so a ratification this record carries cannot be verified");
					return { text: normaliseText(read.value && read.value.text ? read.value.text : ""), exact: false, eof: eof };
				}, function (error) {
					failures.push(path + ": " + describeError(error));
					return null;
				});
			};
			if (typeof files.readAll !== "function") return fromPage("this workspace file API exposes no whole-file read");
			return files.readAll(sessionId, path, signal).then(function (read) {
				var decoded = read !== undefined && read !== null && read.ok === true ? decodeBase64Utf8(read.value && read.value.data) : null;
				if (decoded === null) {
					// Two different failures reach here and they read differently: a whole-file read the
					// host refused, and a payload this platform cannot decode.
					var why = read !== undefined && read !== null && read.ok === true ? "its bytes could not be decoded here" : describeError(read && read.error);
					return fromPage(why);
				}
				return { text: normaliseText(decoded), exact: true, eof: read.value ? read.value.eof !== false : true };
			}, function (error) {
				return fromPage(describeError(error));
			});
		}
		/**
		 * Read one directory's files of one suffix, through the workspace-files Remote.
		 *
		 * The Remote resolves a Session id to its workspace root and returns a
		 * RemoteResult, so every branch is data: an unreadable directory or file is
		 * pushed into `failures` and the remaining items still load. Each file's text
		 * comes from {@link readRecordText}, so a caller can tell a byte-exact text from
		 * a page that only approximates one.
		 *
		 * @returns a promise for the readable items, each
		 *   `{ name, path, text, exact, eof }`.
		 */
		function readDirectory(files, sessionId, dir, suffix, signal, failures) {
			return files.list(sessionId, dir, signal).then(function (listing) {
				if (listing === undefined || listing === null || listing.ok !== true) {
					failures.push(dir + ": " + describeError(listing && listing.error));
					return [];
				}
				var base = listing.value && typeof listing.value.path === "string" && listing.value.path !== "" ? listing.value.path : dir;
				var entries = listing.value && Array.isArray(listing.value.entries) ? listing.value.entries : [];
				var names = entries.filter(function (entry) {
					return entry && entry.type === "file" && typeof entry.name === "string" && entry.name.slice(-suffix.length) === suffix;
				}).map(function (entry) {
					return entry.name;
				});
				if (listing.value && listing.value.truncated === true) failures.push(dir + ": the listing was truncated by the host");
				return Promise.all(names.map(function (name) {
					var path = String(base).replace(/\/+$/, "") + "/" + name;
					return readRecordText(files, sessionId, path, signal, failures).then(function (item) {
						if (item === null) return null;
						return { name: name, path: path, text: item.text, exact: item.exact, eof: item.eof };
					});
				}));
			}, function (error) {
				failures.push(dir + ": " + describeError(error));
				return [];
			});
		}
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
				dirs: { decisionsDir: DEFAULT_DECISIONS_DIR, specsDir: DEFAULT_SPECS_DIR },
				projectName: "this project",
				notes: notes === undefined ? [] : notes,
				failures: failures === undefined ? [] : failures
			};
		}
		/**
		 * Load and derive the whole catalogue for one Session.
		 *
		 * The directories and the project name come from the project's own manifest, so the
		 * panel works in any ratchet project; a missing manifest means the documented
		 * defaults, and an unparseable one is a non-fatal note rather than a failed load.
		 * @returns a promise for
		 *   `{ decisions, consents, specs, relations, lawsByDecision, decisionIds, dirs, projectName, notes, failures }`;
		 *   never rejects.
		 */
		function loadPanel(ctx, sessionId, signal) {
			var files = ctx && ctx.remote ? ctx.remote.workspaceFiles : undefined;
			if (files === undefined || files === null || typeof files.list !== "function" || typeof files.read !== "function") {
				return Promise.resolve(emptyPanel(["the workspace file API is not reachable here: ctx.remote.workspaceFiles.list/read are absent, so no record could be read"]));
			}
			if (typeof sessionId !== "string" || sessionId === "") {
				return Promise.resolve(emptyPanel(["no Session is bound, so the workspace root cannot be resolved"]));
			}
			var failures = [];
			var notes = [];
			return readManifest(files, sessionId, signal).then(function (manifestResult) {
				if (manifestResult.note !== null) notes.push(manifestResult.note);
				var dirs = resolveDirs(manifestResult.manifest);
				var zonePolicy = resolveZonePolicy(manifestResult.manifest);
				return Promise.all([
					readDirectory(files, sessionId, dirs.decisionsDir, ".adr.md", signal, failures),
					readDirectory(files, sessionId, dirs.specsDir, ".spec.md", signal, failures)
				]).then(function (both) {
					var items = both[0].filter(Boolean);
					// Every record's sha256 is computed once, before the relations are built, so a
					// ratification can be matched against the text now in the file. It is taken from
					// the record's WHOLE-FILE text only: a hash over a text that is not the file's own
					// proves nothing, so a record read only as a page is left without one — which the
					// force model treats as no consent, and which the failure line reported for that
					// file explains. A digest that cannot be computed is null for the same reason.
					return Promise.all(items.map(function (item) { return contentHashOf(item.text); })).then(function (hashes) {
					var adrs = items.map(function (item, index) {
						var parsed = parseAdr(item);
						parsed.contentHash = item.exact === true ? hashes[index] : null;
						return parsed;
					}).sort(byAdrId);
					var specs = both[1].filter(Boolean).map(parseSpec);
					var relations = buildRelations(adrs, zonePolicy);
					var decisions = [];
					var consents = [];
					var decisionIds = {};
					var recordIds = {};
					for (var i = 0; i < adrs.length; i += 1) {
						var record = adrs[i];
						if (record.id !== null && record.id !== "") recordIds[record.id] = true;
						if (record.type === "approval") {
							consents.push(record);
							continue;
						}
						var force = displayedState(record, relations, zonePolicy);
						record.state = force.state;
						record.provenance = force.provenance;
						record.canRatify = canOfferRatify(record, relations, zonePolicy);
						record.summary = decisionSummary(record);
						decisions.push(record);
						if (record.id !== null && record.id !== "") decisionIds[record.id] = true;
					}
					// Presentation ordering: an awaiting-human decision is the one a reader came
					// for, so it leads; superseded records sink. Nothing is filtered or changed.
					decisions.sort(byDecisionPriority);
					return {
						decisions: decisions,
						consents: consents,
						specs: specs,
						relations: relations,
						lawsByDecision: lawsByDecision(specs),
						decisionIds: decisionIds,
						recordIds: recordIds,
						dirs: dirs,
						projectName: projectNameOf(manifestResult.manifest, specs),
						notes: notes,
						failures: failures
					};
					});
				});
			}, function (error) {
				return emptyPanel(["the panel could not load: " + describeError(error)], notes);
			});
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
		function summaryStyle() {
			return { fontSize: 12, opacity: 0.85, margin: "6px 0 0", lineHeight: "18px" };
		}
		function warnStyle() {
			return { fontSize: 11, color: "var(--dsw-alias-state-error-primary, #e5735f)", marginTop: 4 };
		}
		function smallButtonStyle() {
			return { appearance: "none", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", background: "transparent", color: "inherit", borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer" };
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
		/** @returns a chip element, optionally clickable and restyled. */
		function chip(text, style, onClick) {
			var props = { style: Object.assign({}, chipStyle(), style || {}) };
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
		 * A section heading: the human title on top and, on a muted second line, the
		 * directory the section was read from. The file pattern is deliberately NOT
		 * shown — it is implementation detail — while the directory is, because that is
		 * the fact a reader needs in order to go and find the file.
		 *
		 * It is a component, so it takes the one props object React passes, not two
		 * positional arguments.
		 * @param props.title - the section title.
		 * @param props.sourceDir - the resolved directory; a null, empty or absent value
		 *   renders the title alone.
		 * @returns the heading element.
		 */
		function sectionHeading(props) {
			var sourceDir = props.sourceDir;
			return React.createElement("div", { style: { margin: "4px 0 8px" } },
				React.createElement("h3", { style: Object.assign({}, sectionHeadingStyle(), { margin: 0 }) }, props.title),
				sourceDir === null || sourceDir === undefined || sourceDir === "" ? null : React.createElement("div", { style: mutedInlineStyle() }, sourceDir));
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
		 * One compiled law, as a card.
		 * @param props.law the compiled law.
		 * @param props.decisionIds map of decision id to boolean, for link-ability.
		 * @param props.decisionStates map of decision id to state kind, or undefined
		 *   when the caller has none. It colours the `decided in` chip so a law whose
		 *   decision is superseded or awaiting a human does not read as if it were in
		 *   force. A missing entry (and an absent map) falls back to `neutral`.
		 * @param props.onSelectAdr callback receiving a decision id.
		 * @returns the card; the `decided in` chip is clickable only when `linked`.
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
			return React.createElement("div", { style: lawCardStyle() },
				React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
					mono(law.id),
					pill("authority: " + (law.authority === null || law.authority === "" ? "unknown" : law.authority), authorityKind(law.authority)),
					pill(
						"decided in " + (law.decidedIn === null || law.decidedIn === "" ? "unknown" : law.decidedIn),
						decidedKind,
						linked ? linkChipStyle() : null,
						linked ? function () { onSelectAdr(law.decidedIn); } : null
					)),
				law.statement === "" ? null : React.createElement("div", { style: { fontSize: 12, marginTop: 4, lineHeight: "18px" } }, law.statement),
				law.checks.length === 0
					? React.createElement("div", { style: mutedStyle() }, "No checks declared.")
					: React.createElement("div", { style: { marginTop: 4, display: "grid", gap: 2 } }, law.checks.map(function (check, index) {
						return React.createElement("div", { key: String(index), style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
							pill(check.type === null || check.type === undefined || check.type === "" ? "unknown" : check.type, checkKind(check.type)),
							mono(check.detail));
					})));
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
		 * INPUTS
		 *   props.adr — the parsed decision record. props.ask — `askConsent(id, sessionId)`,
		 *   or `null` when the route is unreachable. props.settle —
		 *   `settleConsent(id, label, quiz, sessionId)`, or `null` likewise.
		 *   props.sessionId — the Session the window was opened from. props.canAsk — whether
		 *   both are usable in this render. props.onRecorded — called after an approval is
		 *   written, so the window re-reads the corpus that just changed.
		 *
		 * OUTPUTS
		 *   In the idle phase: the two buttons, or — when the route is unreachable — the CLI
		 *   command in their place. While asking: a muted line saying the ratchet is being
		 *   asked. While recording: the ratchet's question with the record's own text and
		 *   both labels, the chosen one marked as being sent. On completion: the outcome —
		 *   an approval's id, file and transcript, a decline that wrote nothing, or the
		 *   ratchet's own refusal with its problem codes. The outcome is never silent.
		 *
		 *   Edge cases: a click when `ask`/`settle` is null reports the route as
		 *   unreachable and sends nothing; a quiz the panel cannot reduce to two labelled
		 *   answers (`claimOfQuiz` returns `null`) reports that the question cannot be put
		 *   and sends no label; a promise rejection is rendered as a message, never thrown
		 *   out of the handler; a second click while a round trip is in flight is refused by
		 *   the phase guard rather than settling one question twice.
		 *
		 * KEYWORDS
		 *   consent route, approve, decline, ratification question, record text, labels,
		 *   outcome, no chat message, no composed answer
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
			/** One click, end to end: ask the ratchet, show its question, send its label. */
			var decide = function (decision) {
				if (phase !== null) return;
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
						settle(adr.id, label, asked.quiz, sessionId).then(
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
							onClick: function () { decide("decline"); }
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
			return React.createElement("div", { style: cardStyle() }, children);
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
		 *   props.decision — `"approve"` or `"decline"`. props.result — the host's response
		 *   object, or a `{ ok: false, error }` value from a transport failure.
		 *
		 * OUTPUTS
		 *   A muted line for a success and a warn line for anything else. It never renders
		 *   nothing, and it never claims a consent the result does not carry: `ok === true`
		 *   AND a written approval is what makes the approval sentence appear.
		 *
		 * KEYWORDS
		 *   outcome, approval written, declined, refusal, problem codes
		 */
		function ConsentOutcome(props) {
			var result = props.result === null || props.result === undefined ? {} : props.result;
			var decision = props.decision;
			var problemCodes = Array.isArray(result.problems) ? result.problems.map(function (entry) { return entry !== null && typeof entry === "object" && typeof entry.code === "string" ? entry.code : null; }).filter(function (code) { return code !== null; }) : [];
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
					"Declined: the ratchet recorded no consent for " + result.rejected.join(", ") + ", so nothing was written and " + (result.rejected.length === 1 ? "the decision stays" : "the decisions stay") + " proposed.");
			}
			if (result.error === "unreachable") {
				return React.createElement("div", { style: warnStyle() }, "Nothing was recorded: this window could not reach the panel's host route, so the ratchet was never asked.");
			}
			if (result.error === "no-question") {
				return React.createElement("div", { style: warnStyle() },
					"Nothing was recorded: the ratchet has no question to put for this decision. ",
					typeof result.message === "string" && result.message !== "" ? result.message : "It is not waiting for a human.");
			}
			if (result.error === "refused" || typeof result.error === "string") {
				return React.createElement("div", { style: warnStyle() },
					"Nothing was recorded: ",
					typeof result.message === "string" && result.message !== "" ? result.message : String(result.error),
					problemCodes.length === 0 ? null : " (" + problemCodes.join(", ") + ")");
			}
			return React.createElement("div", { style: warnStyle() },
				"Nothing was recorded",
				problemCodes.length === 0 ? "." : ": the ratchet refused with " + problemCodes.join(", ") + ".",
				decision === "decline" ? " The decision stays proposed." : null);
		}

		/**
		 * One decision record: identification, derived state, a summary, and — when
		 * expanded — metadata, the laws it decided, and the four body sections. Only a
		 * proposed, agent-authored, not-yet-approved decision gets the ratify affordance,
		 * and that affordance is `ConsentAction`: two buttons whose click records the
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
					React.createElement("span", { style: { fontWeight: 700 } }, adr.title),
					pill(adr.state.text, adr.state.kind, adr.state.derived ? derivedChipStyle() : null),
					provenancePill(adr.provenance, recordIds, onSelectAdr),
					authorPill(adr),
					adr.type === null || adr.type === "" || adr.type === "adr" ? null : pill(adr.type, "neutral"),
					React.createElement("span", { style: disclosureStyle() }, expanded ? "▾" : "▸")),
				adr.summary === "" ? null : React.createElement("div", { key: "summary", style: summaryStyle() }, adr.summary),
				adr.error === null ? null : React.createElement("div", { key: "err", style: warnStyle() }, "frontmatter: " + adr.error)
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
					chip(shortHash(spec.hash)),
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
					: React.createElement("div", { style: { marginTop: 6 } }, spec.laws.map(function (law) {
						return React.createElement(LawCard, { key: law.id, law: law, zone: spec.zone, decisionIds: decisionIds, decisionStates: decisionStates, onSelectAdr: onSelectAdr });
					})));
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
			var emptyView = { status: "idle", decisions: [], consents: [], specs: [], relations: { approvedBy: {}, supersededBy: {} }, lawsByDecision: {}, decisionIds: {}, recordIds: {}, dirs: { decisionsDir: DEFAULT_DECISIONS_DIR, specsDir: DEFAULT_SPECS_DIR }, projectName: "this project", notes: [], failures: [] };
			var view = React.useState(emptyView);
			var current = view[0];
			var setView = view[1];
			var selected = React.useState(null);
			var expandedId = selected[0];
			var setExpandedId = selected[1];
			var seq = React.useState(0);
			var bump = seq[1];
			React.useEffect(function () {
				if (!state.open) return undefined;
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
					if (event && event.key === "Escape") closePanel();
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
			// A recorded answer changes the corpus (an Approval ADR is written), and the row
			// that recorded it knows when: it calls this, so the window re-reads the files that
			// just changed rather than waiting on a timer.
			var onRecorded = function () {
				bump(seq[0] + 1);
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
			};
			var toggle = function (adrId) {
				setExpandedId(expandedId === adrId ? null : adrId);
			};
			return React.createElement("div", { style: overlayBackdropStyle(), role: "presentation" },
				React.createElement("div", { style: overlayWindowStyle(), role: "dialog", "aria-label": "Decisions and specs", onMouseDown: function (event) { event.stopPropagation(); } },
					React.createElement("div", { style: overlayHeaderStyle() },
						React.createElement("div", { style: { minWidth: 0 } },
							React.createElement("div", { style: { fontSize: 14, fontWeight: 600, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
								current.projectName,
								React.createElement("span", { style: { fontSize: 12, fontWeight: 400, opacity: 0.7 } }, "decisions and specs"),
								chip("adr-panel " + PANEL_VERSION)),
							React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 2 } },
								state.sessionId === null ? "no Session bound — open this from a Session header" : "viewer only — the ratchet CLI (ratchet verify) is the authority on what is enforced; states here are read from the corpus files"),
							React.createElement("div", { style: countsStyle() },
								countParts.length === 0 ? "nothing was read" : countParts.join(" · "),
								awaitingCount > 0
									? React.createElement("span", { style: { marginLeft: 8 } }, pill(awaitingCount + " awaiting a human", "pending"))
									: null)),
						React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
							React.createElement("button", { type: "button", style: smallButtonStyle(), disabled: loading, onClick: function () { bump(seq[0] + 1); } }, loading ? "Loading…" : "Reload"),
							React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: closePanel }, "Close"))),
					React.createElement("div", { style: overlayBodyStyle() },
						React.createElement(FailuresBlock, { failures: current.failures }),
						current.notes !== undefined && current.notes.length > 0
							? React.createElement("div", { style: warnStyle() }, current.notes.map(function (note, index) {
								return React.createElement("div", { key: String(index) }, note);
							}))
							: null,
						React.createElement(Legend, null),
						pendingRatify === null ? null : React.createElement("div", null,
							React.createElement(sectionHeading, { title: "Awaiting your answer", sourceDir: current.dirs.decisionsDir }),
							React.createElement(RatifyAnswer, { claim: pendingRatify })),
						React.createElement("div", null,
							React.createElement(sectionHeading, { title: "Decisions", sourceDir: current.dirs.decisionsDir }),
							current.decisions.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No decision files were found in " + current.dirs.decisionsDir + ", or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.decisions.map(function (adr) {
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
								}))),
						React.createElement("div", null,
							React.createElement(sectionHeading, { title: "Consents", sourceDir: current.dirs.decisionsDir }),
							current.consents.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No consent records were found in " + current.dirs.decisionsDir + ".")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.consents.map(function (adr) {
									return React.createElement(ConsentRow, {
										key: adr.path,
										adr: adr,
										expanded: expandedId === adr.id,
										onToggle: function () { toggle(adr.id); }
									});
								}))),
						React.createElement("div", null,
							React.createElement(sectionHeading, { title: "Specs", sourceDir: current.dirs.specsDir }),
							current.specs.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No spec files were found in " + current.dirs.specsDir + ", or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.specs.map(function (spec) {
									return React.createElement(SpecView, { key: spec.path, spec: spec, decisionIds: current.decisionIds, decisionStates: decisionStates, onSelectAdr: onSelectAdr });
								}))))));
		}
		//#endregion

		//#region plugin
		/**
		 * Required browser services: the UI slot registry, the Remote carrier, and the
		 * workspace-files namespace on it. The dotted member is injected explicitly
		 * because that is what the workspace-files client itself declares — without it
		 * `ctx.remote.workspaceFiles` is not guaranteed to resolve, and the panel would
		 * silently fall back to its "file API unreachable" text.
		 */
		const inject = ["slots", "remote", "remote.workspaceFiles"];

		/**
		 * Mount the header trigger, the frame-wide window, and the composer-seat claim.
		 * @param ctx - client root context carrying `slots` and `remote`.
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
