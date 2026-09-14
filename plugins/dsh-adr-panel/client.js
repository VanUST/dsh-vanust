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
 * OUTPUTS
 *   One contribution to `conversation.session.header.actions` and one to
 *   `shell.overlay`. The overlay renders nothing while closed and never mutates a
 *   file. Two record kinds are rendered separately: Decisions (`type !== "approval"`)
 *   and Consents (`type === "approval"`). A decision's displayed state is derived with
 *   the precedence `superseded by <id>` -> `in force (ratified by <id>)` -> its
 *   frontmatter status, and a derived state is labelled so it cannot be mistaken for a
 *   field. The ratify affordance appears ONLY for a decision that is
 *   `type !== "approval"`, frontmatter `status === "proposed"`,
 *   `author.authority === "agent"`, and named by no consent's `approves`; it submits a
 *   user message asking the agent to run `ratchet_ratify`, and when no Session-scoped
 *   submitter is mounted it prints the command instead. It cannot mint a consent: a
 *   consent record is not a decision and is never offered for ratification.
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
 *   - A `decided in <id>` that names no decision in the corpus: the chip is rendered
 *     as plain text and is not clickable.
 *   - Window closed during a load: the AbortController cancels the reads and no state
 *     is written after unmount.
 */
window.__ModuleLoader__.load({
	id: "@cc/dsh-adr-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

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
		 * Parse one ADR file into the fields the panel shows. Every field that does not
		 * parse stays null (or []) and is rendered as `unknown`; nothing is invented.
		 * @param item - `{ name, path, text }` read from `docs/adrs`.
		 * @returns the parsed record; `error` carries a reason when the file failed.
		 */
		function parseAdr(item) {
			var record = {
				id: null, title: item.name, type: null, status: null, authority: null,
				created: null, sourcePath: null, sourceHash: null, zones: [], supersedes: [],
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
				record.created = scalar(lines, "created");
				record.sourcePath = nestedScalar(lines, "source", "path");
				record.sourceHash = nestedScalar(lines, "source", "hash");
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
		 */
		function parseSpec(item) {
			var spec = { name: item.name, path: item.path, zone: null, project: null, hash: null, laws: [], eof: item.eof !== false, error: null };
			try {
				var text = String(item.text == null ? "" : item.text).replace(/^\uFEFF/, "");
				var zone = text.match(/^#[ \t]+Spec:[ \t]*(.+?)[ \t]*$/m);
				var project = text.match(/^Project:[ \t]*(.+?)[ \t]*$/m);
				var hash = text.match(/spec-hash:[ \t]*(sha256:[0-9a-fA-F]+)/);
				spec.zone = zone === null ? null : zone[1].trim();
				spec.project = project === null ? null : project[1].trim();
				spec.hash = hash === null ? null : hash[1];
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
				spec.counts = { laws: spec.laws.length, checks: checks };
			} catch (error) {
				spec.error = describeError(error);
				spec.counts = { laws: 0, checks: 0 };
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
		 * The state a decision is displayed with, in fixed precedence.
		 * @param record - a parsed decision.
		 * @param relations - `{ approvedBy, supersededBy }`.
		 * @returns `{ text, derived }`; `derived` is true when the text was computed
		 *   from another record rather than read from this one's frontmatter.
		 */
		function displayedState(record, relations) {
			var superseded = record.id === null ? undefined : relations.supersededBy[record.id];
			if (superseded !== undefined && superseded.length > 0) {
				return { text: "superseded by " + superseded.join(", "), derived: true };
			}
			var approvals = record.id === null ? undefined : relations.approvedBy[record.id];
			if (approvals !== undefined && approvals.length > 0 && record.status === "proposed") {
				return { text: "in force (ratified by " + approvals.join(", ") + ")", derived: true };
			}
			return { text: record.status === null || record.status === "" ? "unknown" : record.status, derived: false };
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
		//#endregion

		//#region reading
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
						return { name: name, path: path, text: String(read.value && read.value.text ? read.value.text : ""), eof: eof };
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
		 * Load and derive the whole catalogue for one Session.
		 * @returns a promise for
		 *   `{ decisions, consents, specs, relations, lawsByDecision, decisionIds, failures }`;
		 *   never rejects.
		 */
		function loadPanel(ctx, sessionId, signal) {
			var files = ctx && ctx.remote ? ctx.remote.workspaceFiles : undefined;
			if (files === undefined || files === null || typeof files.list !== "function" || typeof files.read !== "function") {
				return Promise.resolve({ decisions: [], consents: [], specs: [], relations: { approvedBy: {}, supersededBy: {} }, lawsByDecision: {}, decisionIds: {}, failures: ["the workspace file API is not reachable here: ctx.remote.workspaceFiles.list/read are absent, so no record could be read"] });
			}
			if (typeof sessionId !== "string" || sessionId === "") {
				return Promise.resolve({ decisions: [], consents: [], specs: [], relations: { approvedBy: {}, supersededBy: {} }, lawsByDecision: {}, decisionIds: {}, failures: ["no Session is bound, so the workspace root cannot be resolved"] });
			}
			var failures = [];
			return Promise.all([
				readDirectory(files, sessionId, "docs/adrs", ".adr.md", signal, failures),
				readDirectory(files, sessionId, "docs/specs", ".spec.md", signal, failures)
			]).then(function (both) {
				var adrs = both[0].filter(Boolean).map(parseAdr).sort(byAdrId);
				var specs = both[1].filter(Boolean).map(parseSpec);
				var relations = buildRelations(adrs);
				var decisions = [];
				var consents = [];
				var decisionIds = {};
				for (var i = 0; i < adrs.length; i += 1) {
					var record = adrs[i];
					if (record.type === "approval") {
						consents.push(record);
						continue;
					}
					record.state = displayedState(record, relations);
					record.canRatify = canOfferRatify(record, relations);
					record.summary = decisionSummary(record);
					decisions.push(record);
					if (record.id !== null && record.id !== "") decisionIds[record.id] = true;
				}
				return {
					decisions: decisions,
					consents: consents,
					specs: specs,
					relations: relations,
					lawsByDecision: lawsByDecision(specs),
					decisionIds: decisionIds,
					failures: failures
				};
			}, function (error) {
				return { decisions: [], consents: [], specs: [], relations: { approvedBy: {}, supersededBy: {} }, lawsByDecision: {}, decisionIds: {}, failures: ["the panel could not load: " + describeError(error)] };
			});
		}
		/** @returns the records ordered by id, then title. */
		function byAdrId(a, b) {
			var left = a.id === null ? "" : String(a.id);
			var right = b.id === null ? "" : String(b.id);
			if (left !== right) return left < right ? -1 : 1;
			return String(a.title === null ? "" : a.title).localeCompare(String(b.title === null ? "" : b.title));
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
		function primaryButtonStyle() {
			return { appearance: "none", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.45))", background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.2))", color: "inherit", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", marginTop: 8 };
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
		var HISTOGRAM_COLORS = ["rgba(120,170,255,0.55)", "rgba(120,220,160,0.55)", "rgba(240,190,110,0.55)", "rgba(220,140,220,0.55)", "rgba(160,160,170,0.55)"];
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
		/** @returns one law as a card, with a clickable `decided in` chip when it links. */
		function LawCard(props) {
			var law = props.law;
			var decisionIds = props.decisionIds;
			var onSelectAdr = props.onSelectAdr;
			var linked = law.decidedIn !== null && law.decidedIn !== "" && decisionIds[law.decidedIn] === true;
			return React.createElement("div", { style: lawCardStyle() },
				React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
					mono(law.id),
					chip("authority: " + (law.authority === null || law.authority === "" ? "unknown" : law.authority)),
					chip(
						"decided in " + (law.decidedIn === null || law.decidedIn === "" ? "unknown" : law.decidedIn),
						linked ? linkChipStyle() : null,
						linked ? function () { onSelectAdr(law.decidedIn); } : null
					)),
				law.statement === "" ? null : React.createElement("div", { style: { fontSize: 12, marginTop: 4, lineHeight: "18px" } }, law.statement),
				law.checks.length === 0
					? React.createElement("div", { style: mutedStyle() }, "No checks declared.")
					: React.createElement("div", { style: { marginTop: 4, display: "grid", gap: 2 } }, law.checks.map(function (check, index) {
						return React.createElement("div", { key: String(index), style: { display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" } },
							chip(check.type),
							mono(check.detail));
					})));
		}
		/** @returns the metadata grid for one decision. */
		function metadataBlock(adr) {
			var rows = [];
			rows = rows.concat(metaRow("type", adr.type, "type"));
			rows = rows.concat(metaRow("state", adr.state.text + (adr.state.derived ? " (derived)" : ""), "state"));
			rows = rows.concat(metaRow("authority", adr.authority, "auth"));
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
						inputActions.setDraft("Please run ratchet_ratify for ADR " + adrId + " and put the decision to me as a question. Do not record a consent on my behalf.");
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
		 * @returns the card.
		 */
		function DecisionRow(props) {
			var adr = props.adr;
			var expanded = props.expanded === true;
			var onToggle = props.onToggle;
			var laws = props.laws === undefined ? [] : props.laws;
			var decisionIds = props.decisionIds;
			var onSelectAdr = props.onSelectAdr;
			var canAsk = props.canAsk;
			var askAgent = props.askAgent;
			var outcome = React.useState(null);
			var result = outcome[0];
			var setResult = outcome[1];
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
					chip(adr.state.text, adr.state.derived ? derivedChipStyle() : null),
					chip(adr.type === null || adr.type === "" ? "type?" : adr.type),
					chip("author: " + (adr.authority === null || adr.authority === "" ? "unknown" : adr.authority)),
					React.createElement("span", { style: disclosureStyle() }, expanded ? "▾" : "▸")),
				adr.summary === "" ? null : React.createElement("div", { key: "summary", style: summaryStyle() }, adr.summary),
				adr.error === null ? null : React.createElement("div", { key: "err", style: warnStyle() }, "frontmatter: " + adr.error)
			];
			if (adr.canRatify === true) {
				children.push(React.createElement("div", { key: "ask", style: { marginTop: 6 } },
					canAsk ? React.createElement("button", { type: "button", style: primaryButtonStyle(), onClick: function () {
						try {
							setResult(askAgent(adr.id) === true ? "submitted" : "unavailable");
						} catch (error) {
							setResult("unavailable");
						}
					} }, "Ask the agent to ratify") : null,
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
					metadataBlock(adr),
					React.createElement("div", null,
						React.createElement("div", { style: subHeadingStyle() }, "Laws decided here (" + laws.length + ")"),
						laws.length === 0
							? React.createElement("div", { style: mutedStyle() }, "No compiled law names this decision.")
							: React.createElement("div", null, laws.map(function (entry) {
								return React.createElement(LawCard, { key: entry.law.id, law: entry.law, zone: entry.zone, decisionIds: decisionIds, onSelectAdr: onSelectAdr });
							}))),
					["Context", "Decision", "Reasoning", "Consequences"].map(function (title) {
						var section = findSection(adr.sections, title);
						return section === null ? null : React.createElement(SectionView, { key: title, section: section });
					})));
			}
			return React.createElement("div", { style: cardStyle() }, children);
		}

		/**
		 * One consent record. It shows what it approves and NEVER offers a ratify
		 * action: a consent is not a decision, and asking to ratify a consent is the
		 * unnecessary recursion.
		 * @returns the card.
		 */
		function ConsentRow(props) {
			var adr = props.adr;
			return React.createElement("div", { style: cardStyle() },
				React.createElement("div", { style: rowHeadStyle() },
					React.createElement("span", { style: badgeStyle() }, "#" + (adr.id === null || adr.id === "" ? "????" : adr.id)),
					React.createElement("span", { style: { fontWeight: 700 } }, adr.title),
					chip(adr.status === null ? "status?" : adr.status),
					chip(adr.type),
					chip("author: " + (adr.authority === null || adr.authority === "" ? "unknown" : adr.authority)),
					chip("approves " + (adr.approves.length === 0 ? "unknown" : adr.approves.join(", ")))),
				adr.approves.length === 0 ? null : React.createElement("div", { style: mutedStyle() }, "Puts into force: " + adr.approves.join(", ") + " at the content hash recorded in its frontmatter."),
				adr.error === null ? null : React.createElement("div", { style: warnStyle() }, "frontmatter: " + adr.error));
		}

		/**
		 * One compiled spec: identity, a check-kind histogram, and one law card per
		 * `##` block. The histogram is the visualization: proportional segments plus a
		 * labelled chip per check kind.
		 * @returns the card.
		 */
		function SpecView(props) {
			var spec = props.spec;
			var decisionIds = props.decisionIds;
			var onSelectAdr = props.onSelectAdr;
			var counts = {};
			var kinds = [];
			for (var i = 0; i < spec.laws.length; i += 1) {
				for (var j = 0; j < spec.laws[i].checks.length; j += 1) {
					var type = spec.laws[i].checks[j].type;
					if (counts[type] === undefined) {
						counts[type] = 0;
						kinds.push(type);
					}
					counts[type] += 1;
				}
			}
			kinds.sort();
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
						return chip(kind + " × " + counts[kind]);
					})),
					React.createElement("div", { style: barStyle() }, kinds.map(function (kind, index) {
						return React.createElement("div", {
							key: kind,
							title: kind + ": " + counts[kind],
							style: { flex: counts[kind], height: "100%", background: HISTOGRAM_COLORS[index % HISTOGRAM_COLORS.length] }
						});
					}))),
				spec.laws.length === 0
					? React.createElement("div", { style: mutedStyle() }, "No law blocks were found in this document.")
					: React.createElement("div", { style: { marginTop: 6 } }, spec.laws.map(function (law) {
						return React.createElement(LawCard, { key: law.id, law: law, zone: spec.zone, decisionIds: decisionIds, onSelectAdr: onSelectAdr });
					})));
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
			var emptyView = { status: "idle", decisions: [], consents: [], specs: [], relations: { approvedBy: {}, supersededBy: {} }, lawsByDecision: {}, decisionIds: {}, failures: [] };
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
							React.createElement("div", { style: { fontSize: 14, fontWeight: 600 } }, "Decisions and specs"),
							React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 2 } },
								state.sessionId === null ? "no Session bound — open this from a Session header" : "viewer only — the ratchet CLI (ratchet verify) is the authority on what is enforced; states here are read from the corpus files")),
						React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
							React.createElement("button", { type: "button", style: smallButtonStyle(), disabled: loading, onClick: function () { bump(seq[0] + 1); } }, loading ? "Loading…" : "Reload"),
							React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: closePanel }, "Close"))),
					React.createElement("div", { style: overlayBodyStyle() },
						React.createElement(FailuresBlock, { failures: current.failures }),
						React.createElement("div", null,
							React.createElement("h3", { style: sectionHeadingStyle() }, "Decisions (docs/adrs/*.adr.md, type ≠ approval)"),
							current.decisions.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No decision records were found, or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.decisions.map(function (adr) {
									return React.createElement(DecisionRow, {
										key: adr.path,
										adr: adr,
										expanded: expandedId === adr.id,
										onToggle: function () { toggle(adr.id); },
										laws: current.lawsByDecision[adr.id],
										decisionIds: current.decisionIds,
										onSelectAdr: onSelectAdr,
										canAsk: canAsk,
										askAgent: askAgent
									});
								}))),
						React.createElement("div", null,
							React.createElement("h3", { style: sectionHeadingStyle() }, "Consents (type: approval)"),
							current.consents.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No consent records were found, or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.consents.map(function (adr) {
									return React.createElement(ConsentRow, { key: adr.path, adr: adr });
								}))),
						React.createElement("div", null,
							React.createElement("h3", { style: sectionHeadingStyle() }, "Specs (docs/specs/*.spec.md)"),
							current.specs.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No spec documents were found, or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.specs.map(function (spec) {
									return React.createElement(SpecView, { key: spec.path, spec: spec, decisionIds: current.decisionIds, onSelectAdr: onSelectAdr });
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
