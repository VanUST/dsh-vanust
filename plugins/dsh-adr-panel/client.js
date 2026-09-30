/**
 * PURPOSE
 *   Browser half of the ADR panel: a Session-header button labelled SPECS that opens a
 *   frame-wide overlay for reading and writing a project's spec documents.
 *
 *   This is the whole UI. There is no ratification surface, no consent, no decision queue,
 *   no law view and no resolve action, because none of those mechanisms exist in this
 *   deployment any more. A spec is markdown a human owns; the panel lists the project's
 *   specs, opens one in a text editor, and saves, creates or deletes it.
 *
 *   ONE SEAT, ONE STATE OWNER. An earlier revision registered the button in
 *   `conversation.session.header.actions` and the window in `shell.overlay`, sharing a store
 *   between two independently-mounted components. That is two registrations that must both
 *   succeed plus a subscription that must fire across them, and when the window's half did not
 *   come up the button simply appeared to do nothing. The window is now rendered by the trigger
 *   itself, from that component's own state, so the click and the window it opens cannot come
 *   apart: there is nothing to subscribe to and no second registration to fail.
 *
 *   ADRs are NOT edited here and are not read here. They remain the plain files a human keeps
 *   under `docs/adrs`, which is the advisory storage they always were once the laws, checks
 *   and consents around them were removed.
 *
 * INPUTS
 *   Loaded by the Web client's module loader as `@cc/dsh-adr-panel/client`. ONE registration:
 *   the Session-header action seat, which supplies `sessionId`. The window reads and writes
 *   through the host half's capability-fenced route, learned at mount time from the index
 *   global `globalThis.__DSH_ADR_PANEL_SPECS__` — `{ route, header, token }`. A missing global
 *   is reported as "the panel host is not mounted" and no request is attempted; the panel never
 *   falls back to reading files itself.
 *
 * OUTPUTS
 *   One contribution to `conversation.session.header.actions`. While closed it renders only the
 *   button. It writes only through the host route, so the host's path validation is the single
 *   place that decides what may be written; this half never constructs a filesystem path.
 *
 * KEYWORDS
 *   adr panel, specs, editor, session header button, overlay, client plugin, single seat
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No capability global: the window says the host half is not mounted and offers no editor,
 *     rather than showing an empty list that reads like "this project has no specs".
 *   - No bound Session: the window says so; the project is resolved from the Session, so there
 *     is nothing to list.
 *   - A failed load: the route's own message is shown.
 *   - Saving with no change, or with an empty body: the button is disabled, because an empty
 *     document is indistinguishable from a deleted one.
 *   - Deleting asks for confirmation in the UI before the request is sent.
 *   - A spec the host reported as unreadable: listed with a warning and opened read-only, so
 *     saving cannot overwrite bytes that were never loaded.
 *   - A click that arrives while a request is in flight: the action buttons disable, so a
 *     double-click cannot issue two writes.
 */

window.__ModuleLoader__.load({
  id: '@cc/dsh-adr-panel',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var h = React.createElement

    /**
     * The panel bundle's own version, shown in the window header.
     *
     * A browser keeps a revision-addressed client bundle until the page reloads, so a stale
     * bundle and a bug look identical without this. Bumped with every change.
     */
    const PANEL_VERSION = '0.3.0'

    /** The index global the host half publishes. */
    const CAPABILITY_GLOBAL = '__DSH_ADR_PANEL_SPECS__'

    /** Section id, stable across reloads so the slot registry can replace it. */
    const SLOT_ID = 'cc-adr-panel'

    /** A new spec's starting content, so a created file is never empty. */
    const NEW_SPEC_TEMPLATE = ['---', 'title: Untitled spec', 'status: active', '---', '', 'Write the requirement here.', ''].join('\n')

    const S = {
      wrap: { display: 'inline-flex' },
      backdrop: {
        position: 'fixed',
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
        // A frame-wide surface must opt back into pointer events: the harness's own overlay
        // layer is click-through so an occupant never blocks the app underneath.
        pointerEvents: 'auto',
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2147483000,
      },
      frame: {
        width: 'min(980px, 92vw)',
        height: 'min(760px, 88vh)',
        background: 'var(--dsh-surface, #1b1b1f)',
        color: 'var(--dsh-text, #e8e8ea)',
        border: '1px solid rgba(127,127,127,0.35)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        font: '13px/1.5 ui-sans-serif, system-ui, sans-serif',
        boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(127,127,127,0.28)',
      },
      title: { fontWeight: 600, fontSize: '14px' },
      chip: { opacity: 0.6, fontSize: '11px', marginLeft: 'auto' },
      body: { flex: '1 1 auto', display: 'flex', minHeight: '0' },
      list: { width: '300px', overflowY: 'auto', borderRight: '1px solid rgba(127,127,127,0.28)', padding: '8px' },
      editor: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: '0', padding: '10px 14px', gap: '8px' },
      row: {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        marginBottom: '4px',
        borderRadius: '6px',
        border: '1px solid transparent',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      },
      rowActive: { background: 'rgba(127,127,127,0.18)', borderColor: 'rgba(127,127,127,0.4)' },
      meta: { opacity: 0.6, fontSize: '11px' },
      input: {
        flex: '0 0 auto',
        height: '34px',
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'rgba(0,0,0,0.25)',
        color: 'inherit',
        font: 'inherit',
      },
      textarea: {
        flex: '1 1 auto',
        width: '100%',
        resize: 'none',
        padding: '10px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'rgba(0,0,0,0.25)',
        color: 'inherit',
        font: '12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      btn: {
        padding: '6px 12px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.4)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      },
      btnPrimary: { borderColor: 'rgba(90,160,255,0.7)', color: '#9dc4ff' },
      btnDanger: { borderColor: 'rgba(255,120,120,0.5)', color: '#ff9d9d' },
      empty: { opacity: 0.6, padding: '10px' },
      warn: { color: '#ffcf7a', fontSize: '12px' },
    }

    /**
     * Read the host capability the page was served with.
     *
     * @returns `{ route, header, token }`, or null when the host half is not mounted in this
     *   composition.
     */
    function capability() {
      var value = globalThis[CAPABILITY_GLOBAL]
      if (value === null || typeof value !== 'object') return null
      if (typeof value.route !== 'string' || typeof value.token !== 'string') return null
      return {
        route: value.route,
        header: typeof value.header === 'string' ? value.header : 'x-adr-panel-specs',
        token: value.token,
      }
    }

    /** The capability headers one request carries. */
    function headersFor(cap) {
      var headers = {}
      headers[cap.header] = cap.token
      return headers
    }

    /**
     * The frame-wide specs window. Owns its own data, its own selection and its own draft —
     * nothing is shared with the trigger beyond the Session id it was opened with.
     *
     * @param props - `{ sessionId, onClose }`.
     * @returns The window element.
     */
    function SpecsWindow(props) {
      var cap = capability()
      var dataState = React.useState({ loading: false, error: null, specs: [] })
      var data = dataState[0]
      var setData = dataState[1]
      var selState = React.useState(null)
      var selected = selState[0]
      var setSelected = selState[1]
      var draftState = React.useState('')
      var draft = draftState[0]
      var setDraft = draftState[1]
      var newState = React.useState('')
      var newName = newState[0]
      var setNewName = newState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      var sessionId = typeof props.sessionId === 'string' && props.sessionId.length > 0 ? props.sessionId : null

      /**
       * Re-read the project's specs from the host route.
       *
       * @returns Nothing; the outcome lands in state.
       */
      function load() {
        if (cap === null || sessionId === null) return
        setData({ loading: true, error: null, specs: [] })
        fetch(cap.route + '?session=' + encodeURIComponent(sessionId), { headers: headersFor(cap) })
          .then(function (response) {
            return response.json().then(function (body) {
              return { ok: response.ok, body: body }
            })
          })
          .then(function (result) {
            if (!result.ok || !result.body || result.body.ok !== true) {
              setData({ loading: false, error: (result.body && result.body.message) || 'the specs route refused the request', specs: [] })
              return
            }
            setData({ loading: false, error: null, specs: result.body.specs || [] })
          })
          .catch(function (error) {
            setData({ loading: false, error: String(error && error.message ? error.message : error), specs: [] })
          })
      }

      // Load once when the window opens. The dependency list is the capability route and the
      // Session, so opening the window for a different Session re-reads rather than showing
      // the previous project's specs.
      React.useEffect(function () {
        load()
      }, [cap === null ? null : cap.route, sessionId])

      /**
       * Send one write or delete request.
       *
       * @param payload - The POST body.
       * @param done - Called with `{ ok, message }` after the round trip.
       * @returns Nothing.
       */
      function post(payload, done) {
        if (cap === null) {
          done({ ok: false, message: 'the panel host is not mounted' })
          return
        }
        setBusy(true)
        fetch(cap.route, {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, headersFor(cap)),
          body: JSON.stringify(Object.assign({ session: sessionId }, payload)),
        })
          .then(function (response) {
            return response.json().then(function (body) {
              return { ok: response.ok, body: body }
            })
          })
          .then(function (result) {
            setBusy(false)
            done({ ok: result.ok && result.body && result.body.ok === true, message: (result.body && result.body.message) || null })
            load()
          })
          .catch(function (error) {
            setBusy(false)
            done({ ok: false, message: String(error && error.message ? error.message : error) })
          })
      }

      /**
       * Open one spec for editing.
       *
       * @param spec - The spec object from the listing.
       * @returns Nothing.
       */
      function open(spec) {
        setSelected(spec)
        setDraft(spec.body || '')
      }

      /**
       * Create a new spec from the name field.
       *
       * @returns Nothing.
       */
      function create() {
        var name = String(newName || '').trim()
        if (name === '') {
          // Never let the click be silent. A disabled button and a handler that returns early
          // are indistinguishable to the human, and the name field is the one input this click
          // depends on — so the empty case states itself instead of doing nothing.
          setData({ loading: false, error: 'type a spec name first, then press Create', specs: data.specs })
          return
        }
        var file = name.toLowerCase().endsWith('.md') ? name : name + '.spec.md'
        var content = NEW_SPEC_TEMPLATE.replace('Untitled spec', name.replace(/\.md$/i, ''))
        post({ file: file, content: content }, function (outcome) {
          if (outcome.ok) {
            setNewName('')
            setSelected({ file: file, title: name, status: 'active', body: content })
            setDraft(content)
          } else {
            setData({ loading: false, error: outcome.message || 'could not create the spec', specs: data.specs })
          }
        })
      }

      /**
       * Save the open spec.
       *
       * @returns Nothing.
       */
      function save() {
        if (selected === null) return
        post({ file: selected.file, content: draft }, function (outcome) {
          if (!outcome.ok) setData({ loading: false, error: outcome.message || 'could not save', specs: data.specs })
        })
      }

      /**
       * Delete the open spec, after a confirmation.
       *
       * @returns Nothing.
       */
      function remove() {
        if (selected === null) return
        if (typeof globalThis.confirm === 'function' && !globalThis.confirm('Delete ' + selected.file + '?')) return
        post({ file: selected.file, remove: true }, function (outcome) {
          if (outcome.ok) {
            setSelected(null)
            setDraft('')
          } else {
            setData({ loading: false, error: outcome.message || 'could not delete', specs: data.specs })
          }
        })
      }

      var rows = data.specs.map(function (spec) {
        var active = selected !== null && selected.file === spec.file
        return h(
          'button',
          {
            key: spec.file,
            type: 'button',
            style: Object.assign({}, S.row, active ? S.rowActive : null),
            onClick: function () {
              open(spec)
            },
          },
          h('div', null, spec.title),
          h('div', { style: S.meta }, spec.file + (spec.status ? '  ·  ' + spec.status : '') + (spec.unreadable ? '  ·  unreadable' : '')),
        )
      })

      var children
      if (cap === null) {
        children = [h('div', { key: 'nohost', style: S.warn }, 'The panel host is not mounted in this composition, so specs cannot be read or written.')]
      } else if (sessionId === null) {
        children = [h('div', { key: 'nosession', style: S.warn }, 'This window is not bound to a Session, so there is no project to show.')]
      } else if (selected === null) {
        children = [
          h('div', { key: 'pick', style: S.empty }, 'Select a spec on the left, or create one.'),
          h(
            'div',
            { key: 'new', style: S.bar },
            h('input', {
              type: 'text',
              placeholder: 'new-spec-name',
              value: newName,
              onChange: function (event) {
                setNewName(event.target.value)
              },
              style: S.input,
            }),
            h(
              'button',
              { type: 'button', style: Object.assign({}, S.btn, S.btnPrimary), disabled: busy, onClick: create },
              'Create',
            ),
          ),
        ]
      } else {
        children = [
          h(
            'div',
            { key: 'hdr', style: S.bar },
            h('strong', null, selected.file),
            selected.unreadable === true ? h('span', { style: S.warn }, 'unreadable — saving would overwrite bytes that were never loaded') : null,
          ),
          h('textarea', {
            key: 'ta',
            style: S.textarea,
            value: draft,
            readOnly: selected.unreadable === true,
            spellCheck: false,
            onChange: function (event) {
              setDraft(event.target.value)
            },
          }),
          h(
            'div',
            { key: 'bar', style: S.bar },
            h(
              'button',
              { type: 'button', style: Object.assign({}, S.btn, S.btnPrimary), disabled: busy || selected.unreadable === true || draft.trim() === '' || draft === selected.body, onClick: save },
              'Save',
            ),
            h('button', { type: 'button', style: Object.assign({}, S.btn, S.btnDanger), disabled: busy, onClick: remove }, 'Delete'),
            h('button', { type: 'button', style: S.btn, disabled: busy, onClick: function () { setSelected(null); setDraft('') } }, 'Back'),
          ),
        ]
      }

      return h(
        'div',
        { style: S.backdrop, onClick: function (event) { if (event.target === event.currentTarget) props.onClose() } },
        h(
          'div',
          { style: S.frame, role: 'dialog', 'aria-label': 'Project specs' },
          h(
            'div',
            { style: S.header },
            h('span', { style: S.title }, 'Specs'),
            h('span', { style: S.meta }, sessionId === null ? 'no session' : 'session bound'),
            h('span', { style: S.chip }, 'adr-panel ' + PANEL_VERSION),
            h('button', { type: 'button', style: S.btn, onClick: props.onClose }, 'Close'),
          ),
          data.error !== null ? h('div', { style: Object.assign({}, S.warn, { padding: '8px 14px' }) }, data.error) : null,
          h(
            'div',
            { style: S.body },
            h('div', { style: S.list }, data.loading ? h('div', { style: S.empty }, 'Loading…') : rows.length === 0 ? h('div', { style: S.empty }, 'No specs in this project yet.') : rows),
            h('div', { style: S.editor }, children),
          ),
        ),
      )
    }

    /**
     * The header button, and the window it opens. Both live in this component's own state, so
     * a click cannot fail to produce the window it opened.
     *
     * @param props - Slot props (`sessionId`) plus this registration's `inject` members.
     * @returns The button, with the window beside it while open.
     */
    function SpecsTrigger(props) {
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      return h(
        'span',
        { style: S.wrap },
        h(
          'button',
          {
            type: 'button',
            title: 'Project specs',
            'aria-label': 'Project specs',
            'data-panel-version': PANEL_VERSION,
            onClick: function () {
              setOpen(true)
            },
            style: S.btn,
          },
          'Specs',
        ),
        open ? h(SpecsWindow, { sessionId: props.sessionId, onClose: function () { setOpen(false) } }) : null,
      )
    }

    /**
     * Required browser services: the UI slot registry only.
     */
    const inject = ['slots']

    /**
     * Mount the header trigger.
     *
     * @param ctx - Client root context carrying `slots`.
     * @returns Nothing; the registration lives inside a `ctx.effect` scope.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: SLOT_ID,
              order: 250,
              inject: function () {
                return { viewer: 'specs' }
              },
            },
            SpecsTrigger,
          )
        })
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
