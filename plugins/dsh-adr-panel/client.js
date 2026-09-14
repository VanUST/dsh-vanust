/**
 * PURPOSE
 *   Browser half of the ADR panel: a Session-header button that opens a frame-wide
 *   overlay listing a project's decision records and spec documents, plus a
 *   read-only affordance that ASKS the agent to run `ratchet_ratify` for a
 *   proposed, agent-authored decision.
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
 *   file. It cannot mint a consent: the only ratification affordance submits a user
 *   message asking the agent to run `ratchet_ratify`, and when no Session-scoped
 *   submitter is mounted it prints the command instead.
 *
 * KEYWORDS
 *   ADR panel, slots, shell.overlay, session header, workspace files, remote,
 *   ratification, ask the agent, read-only
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `ctx.remote.workspaceFiles` absent: the window still renders and shows that
 *     the file API is unreachable; the header button is unaffected.
 *   - No `inputActions` (no live Session composer): the ratify affordance renders the
 *     CLI command instead of a submit button.
 *   - A directory or a single file that cannot be read: reported as a line, and the
 *     rest of the list still renders.
 *   - Frontmatter that does not parse: the record is listed with whatever parsed and
 *     a note; parsing never throws.
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

		//#region frontmatter parsing
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
		 * Parse one ADR file into the fields the panel shows.
		 * @param item - `{ name, path, text }` read from `docs/adrs`.
		 * @returns the parsed record; a field that did not parse stays null and `error`
		 *   carries the reason. Never throws.
		 */
		function parseAdr(item) {
			var record = { id: null, title: item.name, status: null, authority: null, type: null, laws: [], path: item.path, error: null };
			try {
				var split = splitFrontmatter(item.text);
				if (split === null) {
					record.error = "no frontmatter block";
					return record;
				}
				record.id = scalar(split.lines, "id");
				record.title = scalar(split.lines, "title") || item.name;
				record.status = scalar(split.lines, "status");
				record.type = scalar(split.lines, "type");
				record.authority = nestedScalar(split.lines, "author", "authority");
				record.laws = lawIds(split.lines);
			} catch (error) {
				record.error = describeError(error);
			}
			return record;
		}
		/** @returns the first readable paragraph of a markdown body, truncated. */
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
				if (buffer.length === 0 && /^\s*[-*|>]/.test(line)) {
					buffer.push(line.replace(/^\s*[-*|>]\s?/, ""));
					continue;
				}
				buffer.push(line.trim());
			}
			return truncate(buffer.join(" "), 420);
		}
		/**
		 * Render one spec document as a readable item.
		 * @param item - `{ name, path, text, eof }` read from `docs/specs`.
		 * @returns `{ name, path, title, summary, text, eof }`; never throws.
		 */
		function parseSpec(item) {
			try {
				var body = stripFrontmatter(item.text);
				var heading = body.match(/^#[ \t]+(.+)$/m);
				return {
					name: item.name,
					path: item.path,
					title: heading === null ? item.name : heading[1].trim(),
					summary: firstParagraph(body),
					text: body,
					eof: item.eof !== false
				};
			} catch (error) {
				return { name: item.name, path: item.path, title: item.name, summary: "", text: String(item.text == null ? "" : item.text), eof: true, error: describeError(error) };
			}
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
		//#endregion

		//#region reading
		/**
		 * Read one directory's files of one suffix, through the workspace-files Remote.
		 *
		 * The Remote resolves a Session id to its workspace root and returns a
		 * RemoteResult, so every branch is data: an unreadable directory or file is
		 * pushed into `failures` and the remaining items still load.
		 *
		 * @param files - the `remote.workspaceFiles` face.
		 * @param sessionId - the Session whose workspace root resolves the path.
		 * @param dir - a workspace-relative directory.
		 * @param suffix - the filename suffix to keep.
		 * @param signal - aborts the reads when the window closes.
		 * @param failures - the caller's failure accumulator.
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
		 * Load the ADR and spec catalogues for one Session.
		 *
		 * @param ctx - the client root context, read for `remote.workspaceFiles`.
		 * @param sessionId - the Session id, or null when none is bound.
		 * @param signal - aborts the reads.
		 * @returns a promise for `{ adrs, specs, failures }`; never rejects.
		 */
		function loadPanel(ctx, sessionId, signal) {
			var files = ctx && ctx.remote ? ctx.remote.workspaceFiles : undefined;
			if (files === undefined || files === null || typeof files.list !== "function" || typeof files.read !== "function") {
				return Promise.resolve({ adrs: [], specs: [], failures: ["the workspace file API is not reachable here: ctx.remote.workspaceFiles.list/read are absent, so no record could be read"] });
			}
			if (typeof sessionId !== "string" || sessionId === "") {
				return Promise.resolve({ adrs: [], specs: [], failures: ["no Session is bound, so the workspace root cannot be resolved"] });
			}
			var failures = [];
			return Promise.all([
				readDirectory(files, sessionId, "docs/adrs", ".adr.md", signal, failures),
				readDirectory(files, sessionId, "docs/specs", ".spec.md", signal, failures)
			]).then(function (both) {
				return {
					adrs: both[0].filter(Boolean).map(parseAdr).sort(byAdrId),
					specs: both[1].filter(Boolean).map(parseSpec),
					failures: failures
				};
			}, function (error) {
				return { adrs: [], specs: [], failures: ["the panel could not load: " + describeError(error)] };
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
			return { width: "min(900px, 92vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 14, border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", background: "var(--dsw-specific-menu, #1f1f23)", color: "var(--dsw-alias-label-primary, #eaeaea)", boxShadow: "0 18px 60px rgba(0,0,0,0.45)" };
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
		function badgeStyle() {
			return { fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 12, opacity: 0.9 };
		}
		function chipStyle() {
			return { fontSize: 11, padding: "1px 6px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))", opacity: 0.85 };
		}
		function mutedStyle() {
			return { fontSize: 12, opacity: 0.7, margin: "4px 0" };
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
		//#endregion

		//#region components
		/**
		 * The Session-header action. It opens and closes the window and publishes the
		 * submitter the overlay calls: the only place with a live composer.
		 * @param props - standard Session props plus this registration's inject members.
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
		 * One decision record. A proposed, agent-authored record gets the ratify
		 * affordance; every other row is presentation only.
		 * @param props - `{ adr, canAsk, askAgent }`.
		 * @returns the card.
		 */
		function AdrRow(props) {
			var adr = props.adr;
			var canAsk = props.canAsk;
			var askAgent = props.askAgent;
			var outcome = React.useState(null);
			var result = outcome[0];
			var setResult = outcome[1];
			var proposedByAgent = adr.status === "proposed" && adr.authority === "agent";
			var children = [
				React.createElement("div", { key: "head", style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
					React.createElement("span", { style: badgeStyle() }, adr.id === null ? "????" : adr.id),
					React.createElement("span", { style: { fontWeight: 600 } }, adr.title),
					React.createElement("span", { style: chipStyle() }, adr.status === null ? "status?" : adr.status),
					React.createElement("span", { style: chipStyle() }, adr.type === null ? "adr" : adr.type),
					React.createElement("span", { style: chipStyle() }, "author: " + (adr.authority === null ? "?" : adr.authority))),
				adr.laws.length > 0
					? React.createElement("div", { key: "laws", style: { fontSize: 11, opacity: 0.8, marginTop: 4 } }, "laws: " + adr.laws.join(", "))
					: React.createElement("div", { key: "laws", style: { fontSize: 11, opacity: 0.6, marginTop: 4 } }, "no laws declared"),
				adr.error === null ? null : React.createElement("div", { key: "err", style: warnStyle() }, "frontmatter: " + adr.error)
			];
			if (proposedByAgent) {
				children.push(React.createElement("div", { key: "ask", style: { marginTop: 6 } },
					canAsk
						? React.createElement("button", { type: "button", style: primaryButtonStyle(), onClick: function () {
							try {
								setResult(askAgent(adr.id) === true ? "submitted" : "unavailable");
							} catch (error) {
								setResult("unavailable");
							}
						} }, "Ask the agent to ratify")
						: null,
					result === "submitted" ? React.createElement("div", { style: mutedStyle() }, "Asked. Answer the agent's ratification question when it arrives.") : null,
					(!canAsk || result === "unavailable") ? React.createElement("div", { style: mutedStyle() },
						canAsk ? "The composer refused the request. " : "No live Session composer is reachable from this window, so it cannot submit a message. ",
						"Run from a session: ask the agent to call ",
						React.createElement("code", { style: codeStyle() }, "ratchet_ratify"),
						" (or list what waits with ",
						React.createElement("code", { style: codeStyle() }, "node plugins/ratchet/ratchet-cli.mjs pending --root ."),
						").") : null));
			}
			return React.createElement("div", { style: cardStyle() }, children);
		}

		/**
		 * One spec document, rendered as a title, a readable excerpt, and an optional
		 * full-text disclosure — never a raw dump on first sight.
		 * @param props - `{ spec }`.
		 * @returns the card.
		 */
		function SpecRow(props) {
			var spec = props.spec;
			return React.createElement("div", { style: cardStyle() },
				React.createElement("div", { style: { fontWeight: 600 } }, spec.title),
				React.createElement("div", { style: { fontSize: 11, opacity: 0.6, marginTop: 2 } }, spec.path + (spec.eof === false ? " (first page only)" : "")),
				spec.summary === "" ? null : React.createElement("div", { style: { fontSize: 12, marginTop: 6, lineHeight: "18px" } }, spec.summary),
				spec.error === undefined ? null : React.createElement("div", { style: warnStyle() }, spec.error),
				React.createElement("details", { style: { marginTop: 6 } },
					React.createElement("summary", { style: { fontSize: 11, opacity: 0.7, cursor: "pointer" } }, "Full text"),
					React.createElement("pre", { style: { whiteSpace: "pre-wrap", fontSize: 11, lineHeight: "16px", marginTop: 6, maxHeight: 260, overflow: "auto" } }, spec.text)));
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
		 * @param props - root-scope standard props plus this registration's inject members.
		 * @returns the overlay element, or null.
		 */
		function AdrPanelOverlay(props) {
			var state = props.usePanel(function (snapshot) {
				return snapshot;
			});
			var closePanel = props.closePanel;
			var askAgent = props.askAgent;
			var load = props.load;
			var view = React.useState({ status: "idle", adrs: [], specs: [], failures: [] });
			var current = view[0];
			var setView = view[1];
			var seq = React.useState(0);
			var bump = seq[1];
			React.useEffect(function () {
				if (!state.open) return undefined;
				var controller = typeof AbortController === "function" ? new AbortController() : null;
				var alive = true;
				setView({ status: "loading", adrs: current.adrs, specs: current.specs, failures: current.failures });
				load(controller === null ? undefined : controller.signal).then(function (result) {
					if (!alive) return;
					setView({ status: "ready", adrs: result.adrs === undefined ? [] : result.adrs, specs: result.specs === undefined ? [] : result.specs, failures: result.failures === undefined ? [] : result.failures });
				}, function (error) {
					if (!alive) return;
					setView({ status: "ready", adrs: [], specs: [], failures: ["the panel could not load: " + describeError(error)] });
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
			return React.createElement("div", { style: overlayBackdropStyle(), role: "presentation" },
				React.createElement("div", { style: overlayWindowStyle(), role: "dialog", "aria-label": "Decisions and specs", onMouseDown: function (event) { event.stopPropagation(); } },
					React.createElement("div", { style: overlayHeaderStyle() },
						React.createElement("div", { style: { minWidth: 0 } },
							React.createElement("div", { style: { fontSize: 14, fontWeight: 600 } }, "Decisions and specs"),
							React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 2 } },
								state.sessionId === null ? "no Session bound — open this from a Session header" : "read-only; this window cannot record a consent")),
						React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
							React.createElement("button", { type: "button", style: smallButtonStyle(), disabled: loading, onClick: function () { bump(seq[0] + 1); } }, loading ? "Loading…" : "Reload"),
							React.createElement("button", { type: "button", style: smallButtonStyle(), onClick: closePanel }, "Close"))),
					React.createElement("div", { style: overlayBodyStyle() },
						React.createElement(FailuresBlock, { failures: current.failures }),
						React.createElement("div", null,
							React.createElement("h3", { style: sectionHeadingStyle() }, "Decisions (docs/adrs/*.adr.md)"),
							current.adrs.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No ADR files were found, or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.adrs.map(function (adr) {
									return React.createElement(AdrRow, { key: adr.path, adr: adr, canAsk: canAsk, askAgent: askAgent });
								}))),
						React.createElement("div", null,
							React.createElement("h3", { style: sectionHeadingStyle() }, "Specs (docs/specs/*.spec.md)"),
							current.specs.length === 0
								? React.createElement("p", { style: mutedStyle() }, "No spec documents were found, or none could be read.")
								: React.createElement("div", { style: { display: "grid", gap: 8 } }, current.specs.map(function (spec) {
									return React.createElement(SpecRow, { key: spec.path, spec: spec });
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
