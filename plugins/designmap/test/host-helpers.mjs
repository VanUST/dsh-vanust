/** Shared fixture and harness helpers for the M3 host-tool tests. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export const DEFAULT_MODEL = `schemaVersion: 1
groups: []
nodes:
  - id: svc.checkout.api
    type: service
    label: Checkout API
    group: null
    source: src/checkout/api.ts
  - id: db.orders
    type: datastore
    label: Orders DB
    group: null
    source: src/orders/schema.sql
edges:
  - id: e.api.db
    from: svc.checkout.api
    to: db.orders
    kind: data
    label: SQL / reads
`

export const DEFAULT_VIEWS = `schemaVersion: 1
views:
  - id: v.context
    title: Checkout — context
    level: context
    direction: LR
    include: []
    parent: null
`

export const DEFAULT_FILES = {
  'src/checkout/api.ts': 'export const api = 1\n',
  'src/orders/schema.sql': 'create table orders(id int);\n',
}

/**
 * A real git repository with a designmap directory and an initial commit.
 * @returns helpers to write files, run git, and clean up.
 */
export function makeRepo({ model = DEFAULT_MODEL, views = DEFAULT_VIEWS, overlays = null, files = DEFAULT_FILES } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'designmap-host-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'designmap@example.test')
  git(root, 'config', 'user.name', 'Designmap Test')
  const write = (relative, content) => {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  for (const [path, content] of Object.entries(files)) write(path, content)
  write('designmap/model.yaml', model)
  write('designmap/views.yaml', views)
  if (overlays !== null) write('designmap/overlays.json', `${JSON.stringify(overlays, null, 2)}\n`)
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'base')
  return {
    root,
    designmapDir: join(root, 'designmap'),
    write,
    git: (...args) => git(root, ...args),
    head: () => git(root, 'rev-parse', 'HEAD'),
    commitAll: message => {
      git(root, 'add', '-A')
      git(root, 'commit', '-qm', message)
      return git(root, 'rev-parse', 'HEAD')
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** Load the real dsh-tools package from the installed harness, or null when absent. */
export async function loadDshTools() {
  try {
    return await import('@deepseek-ai/dsh-tools')
  } catch {
    // fall through: resolve from the installed harness
  }
  const { existsSync } = await import('node:fs')
  const { pathToFileURL } = await import('node:url')
  const installed = process.env.DSH_INSTALL ?? '/home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh'
  const candidate = process.env.DSH_TOOLS
    ?? join(installed, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  if (!existsSync(candidate)) return null
  return import(pathToFileURL(candidate).href)
}

/** A stub defineTool: keeps the authored spec and the execute function callable in tests. */
export function stubDefineTool(options) {
  return { ...options }
}
