/**
 * PURPOSE
 *   Browser half of the ADR panel: a Session-header button that opens a frame-wide
 *   overlay showing a project's decision corpus and its compiled specs as a
 *   readable, cross-linked view. It is a VIEWER: the ratchet CLI (`ratchet verify`)
 *   remains the authority on what is enforced, and every state it displays is read
 *   from the corpus files. The one action it offers is read-only: it ASKS the agent
 *   to run `ratchet_ratify` for a decision that still needs a human.
 *
 * INPUTS
 *   Loaded by the Web client's module loader as `@cc/dsh-adr-panel/client`. The two
 *   registrations receive the standard slot props of their scope — the Session-header
 *   action seat supplies `sessionId` and `inputActions`; the frame-wide overlay seat
 *   supplies only root-scope props — plus the members returned by each registration's
 *   `inject` factory. Decision and spec text is read through
 *   `ctx.remote.workspaceFiles.list/read`, addressed by the Session id.
 *
 *   PROJECT-AGNOSTIC: the node that renders is discovered from the project itself, not
 *   hardcoded. `.dsh/project.json` is read once per load for `ratchet.decisionsDir`,
 *   `ratchet.specsDir` and `name`, falling back to `docs/adrs`, `docs/specs` and the
 *   first spec's `Project:` line when the manifest is absent, unparseable or silent.
 *   No zone name, law-id shape, file name beyond the `*.adr.md` / `*.spec.md` suffixes,
 *   or presence of any record is assumed.
 *
 *   DIAGNOSTIC: the window header carries this bundle's own `PANEL_VERSION`. A browser
 *   keeps its revision-addressed client bundle until the page reloads, so without a
 *   version a stale bundle and a bug look identical.
 *
 * OUTPUTS
 *   One contribution to `conversation.session.header.actions` and one to
 *   `shell.overlay`. The overlay renders nothing while closed and never mutates a
 *   file. Two record kinds are rendered separately: Decisions (`type !== "approval"`)
 *   and Consents (`type === "approval"`). There is exactly ONE force state: a record
 *   whose frontmatter says `active` and a proposed record a consent put into force both
 *   read `in force`, and HOW it entered force is a separate provenance pill — `ratified
 *   by <ids>` (a link to the consent, success tone), `agent-activated` (in force on an
 *   agent's say-so, warn tone because no human has seen it) or `human-authored`
 *   (business tone). `awaiting a human`, `superseded by <id>`, `rejected` and
 *   `withdrawn` are states with no provenance pill. A state computed from another
 *   record rather than read from this record's frontmatter is rendered dashed/italic.
 *   The ratify affordance appears ONLY for a decision that is
 *   `type !== "approval"`, frontmatter `status === "proposed"`,
 *   `author.authority === "agent"`, and named by no consent's `approves`; it submits the
 *   ratchet's own `/ratify <id>` command, which runs host-side without a model turn and
 *   puts the ratchet's question to the human through the question channel, and when no
 *   Session-scoped submitter is mounted it prints the command instead. It cannot mint a
 *   consent: the answer is the human's, and a consent record is not a decision and is
 *   never offered for ratification.
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
 *   shell.overlay, session header, workspace files, remote, ratification, ask the
 *   agent, read-only, viewer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `ctx.remote.workspaceFiles` absent: the window still renders and shows that
 *     the file API is unreachable; the header button is unaffected.
 *   - No `inputActions` (no live Session composer): the ratify affordance renders the
 *     CLI command instead of a submit button.
 *   - A directory or a single file that cannot be read: reported as a line, and the
 *     rest of the list still renders.
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
 *     is written after unmount.
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
		 * change to this file, and keep it equal to the package's version.
		 */
		const PANEL_VERSION = "0.1.10";
		/** The manifest a ratchet project declares its directories and name in. */
		const MANIFEST_PATH = ".dsh/project.json";
		/** Directories used when the manifest is absent, unparseable, or silent. */
		const DEFAULT_DECISIONS_DIR = "docs/adrs";
		const DEFAULT_SPECS_DIR = "docs/specs";

		//#region panel store
		/**
		 * The panel's shared view state. It is not harness state: it holds only
		 * whether the window is open, which Session it was opened from, and the
		 * submitter the Session-header entry publishes for the overlay to call.
		 * @returns a bare getSnapshot/subscribe source the renderer binds into a hook.
		 */
		function createPanelStore() {
			var state = { open: false, sessionId: null, ask: null };
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
		 * Read one YAML-style list: `key: []`, a one-line inline value, or a block of
		 * `- item` lines. Only the flat shapes this corpus uses are understood.
		 * @returns an array of scalar strings; `[]` when the block is empty or absent.
		 */
		function listValues(lines, key) {
			var re = new RegExp("^" + key + ":[ \t]*(.*)$");
			for (var i = 0; i < lines.length; i += 1) {
				var match = lines[i].match(re);
				if (match === null) continue;
				var inline = unquote(match[1]);
				if (inline === "[]") return [];
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
		 * Parse one ADR file into the fields the panel shows. Every field that does not
		 * parse stays null (or []) and is rendered as `unknown`; nothing is invented.
		 * @param item - `{ name, path, text }` read from `docs/adrs`.
		 * @returns the parsed record; `error` carries a reason when the file failed.
		 */
		function parseAdr(item) {
			var record = {
				id: null, title: item.name, type: null, status: null, authority: null, authorName: null,
				created: null, sourcePath: null, sourceHash: null, ratificationAt: null, zones: [], supersedes: [],
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
		 * Build the whole-corpus relation maps a viewer needs.
		 *
		 * `approvedBy` maps an approved decision id to the approval ids that name it in
		 * `approves`; `supersededBy` maps a superseded id to the record ids that name it
		 * in `supersedes`. Both are read from the files, never inferred from a status
		 * field: a consent record IS how a decision enters force, and a status field an
		 * agent can write is exactly what the gate exists to check.
		 *
		 * @param adrs - every parsed record.
		 * @returns `{ approvedBy, supersededBy }`, each a plain object of arrays.
		 */
		function buildRelations(adrs) {
			var approvedBy = {};
			var supersededBy = {};
			for (var i = 0; i < adrs.length; i += 1) {
				var record = adrs[i];
				var name = record.id === null ? record.path : record.id;
				for (var a = 0; a < record.approves.length; a += 1) {
					if (approvedBy[record.approves[a]] === undefined) approvedBy[record.approves[a]] = [];
					approvedBy[record.approves[a]].push(name);
				}
				for (var s = 0; s < record.supersedes.length; s += 1) {
					if (supersededBy[record.supersedes[s]] === undefined) supersededBy[record.supersedes[s]] = [];
					supersededBy[record.supersedes[s]].push(name);
				}
			}
			return { approvedBy: approvedBy, supersededBy: supersededBy };
		}
		/**
		 * The state a decision is displayed with, in fixed precedence, and the separate
		 * provenance of its force.
		 *
		 * There is exactly ONE force state. `status: active` and a proposed record put into
		 * force by a consent are both `in force`; they differ only in provenance, which is
		 * a second pill: `ratified by <ids>` (a human consented), `agent-activated` (in
		 * force on an agent's say-so, rendered as attention rather than failure) or
		 * `human-authored`. A proposed record no consent names is `awaiting a human` and
		 * carries no provenance pill. Supersession, rejection and withdrawal are states
		 * with no provenance, because how they entered force is no longer the question.
		 *
		 * @param record - a parsed decision.
		 * @param relations - `{ approvedBy, supersededBy }`.
		 * @returns `{ state, provenance }`. `state` is `{ text, kind, derived }`, where
		 *   `derived` marks a value computed from another record rather than read from this
		 *   one's frontmatter. `provenance` is `{ text, kind, link }` or null, where `link`
		 *   names the consent records a `ratified by` pill may select.
		 */
		function displayedState(record, relations) {
			var approvals = record.id === null ? undefined : relations.approvedBy[record.id];
			var ratified = approvals !== undefined && approvals.length > 0;
			var superseded = record.id === null ? undefined : relations.supersededBy[record.id];
			if (superseded !== undefined && superseded.length > 0) {
				return { state: { text: "superseded by " + superseded.join(", "), kind: "superseded", derived: true }, provenance: null };
			}
			if (record.status === "rejected" || record.status === "withdrawn") {
				return { state: { text: record.status, kind: stateKindOfStatus(record.status), derived: false }, provenance: null };
			}
			if (record.status === "proposed" && !ratified) {
				return { state: { text: "awaiting a human", kind: "pending", derived: false }, provenance: null };
			}
			var activeInFrontmatter = record.status === "active";
			if (!activeInFrontmatter && !ratified) {
				var unknown = record.status === null || record.status === "" ? "unknown" : record.status;
				return { state: { text: unknown, kind: stateKindOfStatus(unknown), derived: false }, provenance: null };
			}
			var provenance = null;
			if (ratified) provenance = { text: "ratified by " + approvals.join(", "), kind: "ratified", link: approvals };
			else if (record.authority === "human") provenance = { text: "human-authored", kind: "human", link: null };
			else if (record.authority === "agent") provenance = { text: "agent-activated", kind: "pending", link: null };
			return {
				state: { text: "in force", kind: "in-force", derived: !activeInFrontmatter },
				provenance: provenance
			};
		}
		/**
		 * Whether the ratify affordance may be offered for a record.
		 *
		 * All four conditions are required. A consent record is never offered one — that
		 * is the unnecessary recursion — and an already-approved or superseded decision is
		 * not either, because asking a human to ratify what is already in force proposes
		 * nothing.
		 *
		 * @param record - a parsed record.
		 * @param relations - `{ approvedBy, supersededBy }`.
		 * @returns true only when the record is a decision awaiting a first consent.
		 */
		function canOfferRatify(record, relations) {
			if (record.type === "approval") return false;
			if (record.status !== "proposed") return false;
			if (record.authority !== "agent") return false;
			var approvals = record.id === null ? undefined : relations.approvedBy[record.id];
			return approvals === undefined || approvals.length === 0;
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
		 * Read one directory's files of one suffix, through the workspace-files Remote.
		 *
		 * The Remote resolves a Session id to its workspace root and returns a
		 * RemoteResult, so every branch is data: an unreadable directory or file is
		 * pushed into `failures` and the remaining items still load.
		 *
		 * @returns a promise for the readable items.
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
					return files.read(sessionId, path, {}, signal).then(function (read) {
						if (read === undefined || read === null || read.ok !== true) {
							failures.push(path + ": " + describeError(read && read.error));
							return null;
						}
						var eof = read.value ? read.value.eof !== false : true;
						if (eof === false) failures.push(path + ": only the first page was read, so the panel may be incomplete");
						return { name: name, path: path, text: normaliseText(read.value && read.value.text ? read.value.text : ""), eof: eof };
					}, function (error) {
						failures.push(path + ": " + describeError(error));
						return null;
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
				return Promise.all([
					readDirectory(files, sessionId, dirs.decisionsDir, ".adr.md", signal, failures),
					readDirectory(files, sessionId, dirs.specsDir, ".spec.md", signal, failures)
				]).then(function (both) {
					var adrs = both[0].filter(Boolean).map(parseAdr).sort(byAdrId);
					var specs = both[1].filter(Boolean).map(parseSpec);
					var relations = buildRelations(adrs);
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
						var force = displayedState(record, relations);
						record.state = force.state;
						record.provenance = force.provenance;
						record.canRatify = canOfferRatify(record, relations);
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
		 * The Session-header action. It opens and closes the window and publishes the
		 * submitter the overlay calls: the only place with a live composer.
		 * @returns the header button.
		 */
		function AdrPanelTrigger(props) {
			var open = props.usePanel(function (state) {
				return state.open;
			});
			var openPanel = props.openPanel;
			var closePanel = props.closePanel;
			var publishAsk = props.publishAsk;
			var inputActions = props.inputActions;
			var sessionId = props.sessionId;
			React.useEffect(function () {
				if (inputActions === undefined || inputActions === null || typeof inputActions.setDraft !== "function" || typeof inputActions.submit !== "function") {
					publishAsk(null);
					return undefined;
				}
				publishAsk(function (adrId) {
					try {
						// The ratchet's own command, not a sentence to the model. A command is
						// executed host-side without a model turn, and its handler holds the
						// session's agent, so the ratchet puts its question to the human
						// directly. The answer is still the human's; nothing here composes one.
						inputActions.setDraft("/ratify " + adrId);
						inputActions.submit();
					} catch (error) {
						if (typeof console !== "undefined" && console.error) console.error("[adr-panel] could not submit the ratify request", error);
					}
				});
				return function () {
					publishAsk(null);
				};
			}, [inputActions, publishAsk]);
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
		 * One decision record: identification, derived state, a summary, and — when
		 * expanded — metadata, the laws it decided, and the four body sections. Only a
		 * proposed, agent-authored, not-yet-approved decision gets the ratify affordance.
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
			var askAgent = props.askAgent;
			var outcome = React.useState(null);
			var result = outcome[0];
			var setResult = outcome[1];
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
					canAsk ? React.createElement("button", { type: "button", style: primaryButtonStyle(colours), onClick: function () {
						try {
							setResult(askAgent(adr.id) === true ? "submitted" : "unavailable");
						} catch (error) {
							setResult("unavailable");
						}
					} }, "Ask the agent to ratify") : null,
					React.createElement("div", { key: "note", style: ctaNoteStyle() }, "This asks the agent to put the decision to you as a question. It does not record a consent; only your answer does."),
					result === "submitted" ? React.createElement("div", { style: mutedStyle() }, "Asked. Answer the agent's ratification question when it arrives.") : null,
					(!canAsk || result === "unavailable") ? React.createElement("div", { style: mutedStyle() },
						canAsk ? "The composer refused the request. " : "No live Session composer is reachable from this window, so it cannot submit a message. ",
						"Run from a session: ask the agent to call ",
						mono("ratchet_ratify"),
						" (or list what waits with ",
						mono("node plugins/ratchet/ratchet-cli.mjs pending --root ."),
						").") : null));
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
			var askAgent = props.askAgent;
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
			var canAsk = typeof state.ask === "function";
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
										askAgent: askAgent
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
		 * Mount the header trigger and the frame-wide window.
		 * @param ctx - client root context carrying `slots` and `remote`.
		 * @returns Nothing; both registrations live inside `ctx.effect` scopes.
		 */
		function apply(ctx) {
			const store = createPanelStore();
			ctx.effect(function () {
				return ctx.slots.inject("conversation.session.header.actions", function () {
					return ctx.slots.register({
						name: "conversation.session.header.actions",
						id: "cc-adr-panel",
						order: 250,
						inject: function () {
							return {
								hooks: { panel: store },
								openPanel: function (sessionId) {
									store.set({ open: true, sessionId: typeof sessionId === "string" && sessionId !== "" ? sessionId : null });
								},
								closePanel: function () {
									store.set({ open: false });
								},
								publishAsk: function (submitter) {
									store.set({ ask: typeof submitter === "function" ? submitter : null });
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
								askAgent: function (adrId) {
									var submitter = store.getSnapshot().ask;
									if (typeof submitter !== "function") return false;
									try {
										submitter(adrId);
										return true;
									} catch (error) {
										return false;
									}
								},
								load: function (signal) {
									return loadPanel(ctx, store.getSnapshot().sessionId, signal);
								}
							};
						}
					}, AdrPanelOverlay);
				});
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
