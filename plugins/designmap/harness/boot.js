/* Mount the real designmap client module on the real DSH loader, against a scripted
 * remote. Scene files, view metadata and source stats come from harness/serve.mjs;
 * nothing here is part of the product bundle. */
(() => {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('set')
  const set = requested === 'm0' || requested === 'empty' || requested === 'm2' || requested === 'repo' || requested === 'readability' ? requested : 'repo'
  const ID = '@cc/dsh-designmap'
  const bridge = {
    ready: false,
    set,
    events: [],
    opens: [],
    commands: [],
    loads: 0,
    error: null,
  }
  window.__M1__ = bridge

  const json = async (url) => {
    const response = await fetch(url, { cache: 'no-store' })
    return response.json()
  }

  const workspaceMode = set === 'm2'
  const remote = {
    workspaceFiles: {
      list: async (_sessionId, dir) => {
        bridge.loads += 1
        return workspaceMode
          ? json(`/stub/fs/list?dir=${encodeURIComponent(dir)}`)
          : json(`/stub/list?set=${set}&dir=${encodeURIComponent(dir)}`)
      },
      read: async (_sessionId, path) =>
        workspaceMode ? json(`/stub/fs/read?path=${encodeURIComponent(path)}`) : json(`/stub/read?set=${set}&path=${encodeURIComponent(path)}`),
      stat: async (_sessionId, path) =>
        workspaceMode ? json(`/stub/fs/stat?path=${encodeURIComponent(path)}`) : json(`/stub/stat?path=${encodeURIComponent(path)}`),
    },
    session: {
      openWorkspacePath: async (request) => {
        bridge.opens.push(request)
        return json(`/stub/open?path=${encodeURIComponent(request.path)}`)
      },
    },
    // Available in every mode: the panel's edit mode needs the command path, and the
    // scene source (a pinned set or the workspace) is independent of it.
    commands: {
      execute: async (_sessionId, line) => {
        bridge.commands.push(line)
        const response = await fetch('/stub/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ line }),
        })
        return response.json()
      },
    },
  }

  const boot = {
    rev: 'm1-harness',
    release: { version: 'm1-harness' },
    entries: [{ id: ID, url: `/plugins/${ID}/client.js?rev=m1-harness`, rev: 'm1-harness' }],
    batches: [{ phase: 'application', url: '/client.js?rev=m1-harness', rev: 'm1-harness', entries: [ID] }],
  }

  const showError = (error) => {
    bridge.error = error && error.stack ? error.stack : String(error)
    const host = document.getElementById('boot-error')
    if (host !== null) {
      host.hidden = false
      host.textContent = bridge.error
    }
    console.error(error)
  }

  window.__M1_READY__ = (async () => {
    let viewIndex = null
    if (!workspaceMode) {
      const index = await json(`/scenes/${set}/index.json`)
      viewIndex = {
        rootId: index.root,
        views: index.views.map((entry) => ({
          viewId: entry.viewId,
          parentGroupId: entry.parentGroupId ?? null,
          title: entry.title ?? null,
          level: entry.level ?? null,
          meta: entry.meta ?? null,
        })),
      }
    }
    const system = window.__ModuleLoader__.create({ boot, staticModules: window.__SPIKE_SEED__ })
    window.__M1_LOADER__ = system
    const exports = await system.import(ID, '', {})
    const host = exports.createRemoteHost({ remote, sessionId: 'session-m1-harness', viewIndex })
    const originalLoad = host.load.bind(host)
    host.load = async () => {
      bridge.loads += 1
      return originalLoad()
    }
    host.onEvent = (event) => {
      bridge.events.push(event)
    }
    const React = window.__SPIKE_SEED__.react
    const { createRoot } = window.__SPIKE_SEED__['react-dom/client']
    const container = document.getElementById('root')
    createRoot(container).render(React.createElement(exports.DesignMapView, { host }))
    bridge.mounted = true
    return exports
  })().catch(showError)

  // Ready means the view is on screen (or its empty/error state), not merely mounted.
  const wait = () => {
    if (document.querySelector('.dmv')) {
      bridge.ready = true
      return
    }
    window.setTimeout(wait, 25)
  }
  window.setTimeout(wait, 25)
})()
