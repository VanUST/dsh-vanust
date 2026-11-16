/**
 * Static harness server for the M1 panel. It serves the real loader, the built client
 * bundle and two scene sets, and it scripts the `remote` face the panel would get from
 * the host:
 *   /stub/list|read  → scene files and index from harness/scenes/<set>/
 *   /stub/stat       → a real, read-only stat under the repository root
 *   /stub/open       → acknowledges a verified path (the page records the call)
 *
 * No writes, no install, no dependency beyond node:http.
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createCommandHandler } from '../src/command.mjs'
import { createFileLogger, createHostService } from '../src/host.mjs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const REPO = resolve(PKG, '..', '..')
const SCENES = join(HERE, 'scenes')
const WORKSPACE = join(HERE, 'workspace')
const DESIGNMAP = join(WORKSPACE, 'designmap')
const PORT = Number(process.env.M1_PORT ?? 4320)

const hostFor = () => {
  const { logger } = createFileLogger(DESIGNMAP)
  return { service: createHostService({ designmapDir: DESIGNMAP, repoRoot: WORKSPACE, logger }), logger }
}
const command = createCommandHandler({ hostFor })

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function remoteResult(response, answer) {
  return json(response, 200, { ok: true, value: { result: answer } })
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const json = (response, status, value) => {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.byteLength })
  response.end(body)
}

const fail = (response, code, message, details) => json(response, 200, { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } })

async function readIndex(set) {
  const text = await readFile(join(SCENES, set, 'index.json'), 'utf8')
  return JSON.parse(text)
}

function inside(root, target) {
  return target === root || target.startsWith(root + sep)
}

async function serveStatic(response, pathname) {
  const target = normalize(join(HERE, pathname === '/harness' ? '/harness/index.html' : pathname))
  const allowed = inside(HERE, target) || inside(PKG, target)
  if (!allowed) return false
  try {
    const info = await stat(target)
    if (!info.isFile()) return false
    const body = await readFile(target)
    response.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': body.byteLength })
    response.end(body)
    console.log(`200 ${pathname} ${body.byteLength}B`)
    return true
  } catch {
    return false
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const pathname = url.pathname
  try {
    if (pathname === '/') return void serveStatic(response, '/index.html')
    if (pathname === '/seed.js' || pathname === '/boot.js' || pathname === '/vendor/dsh-client-modules.client.js' || pathname === '/build-manifest.json') {
      if (await serveStatic(response, pathname)) return
      return void response.writeHead(404).end('not found')
    }
    if (pathname.startsWith('/scenes/')) {
      if (await serveStatic(response, pathname)) return
      return void response.writeHead(404).end('not found')
    }
    if (pathname === '/client.js') {
      const body = await readFile(join(PKG, 'client.js'))
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.byteLength })
      response.end(body)
      console.log(`200 /client.js ${body.byteLength}B`)
      return
    }

    if (pathname === '/stub/fs/list') {
      const dir = url.searchParams.get('dir') ?? ''
      if (dir !== 'designmap/out') return json(response, 200, { ok: true, value: { entries: [] } })
      let names = []
      try {
        const index = JSON.parse(await readFile(join(DESIGNMAP, 'out', 'index.json'), 'utf8'))
        names = index.views.map((row) => row.scenePath.replace(/^out\//, ''))
      } catch {
        names = (await readdir(join(DESIGNMAP, 'out'))).filter((name) => name.endsWith('.scene.json'))
      }
      return json(response, 200, { ok: true, value: { entries: names.map((name) => ({ name, kind: 'file', path: `designmap/out/${name}` })) } })
    }

    if (pathname === '/stub/fs/read') {
      const raw = url.searchParams.get('path') ?? ''
      if (raw !== 'designmap/out/index.json' && raw !== 'designmap/overlays.json' && raw !== 'designmap/manifest.json' && !/^designmap\/out\/[A-Za-z0-9._-]+\.scene\.json$/.test(raw)) {
        return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      }
      const file = join(WORKSPACE, raw)
      if (!inside(WORKSPACE, file)) return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      try {
        const text = await readFile(file, 'utf8')
        return json(response, 200, { ok: true, value: { text, absolutePath: file, version: 'harness-workspace', offset: 1, lines: text.split('\n').length, eof: true } })
      } catch {
        return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      }
    }

    if (pathname === '/stub/fs/stat') {
      const raw = url.searchParams.get('path') ?? ''
      const file = resolve(WORKSPACE, raw)
      if (!inside(WORKSPACE, file)) return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      try {
        const info = await stat(file)
        if (!info.isFile()) throw new Error('not a file')
        return json(response, 200, { ok: true, value: { absolutePath: file, version: 'harness-stat', bytes: info.size } })
      } catch {
        return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      }
    }

    if (pathname === '/stub/command' && request.method === 'POST') {
      let parsed
      try {
        parsed = JSON.parse(await readBody(request))
      } catch {
        return json(response, 200, { ok: false, error: { code: 'bad_request', message: 'expected JSON' } })
      }
      const line = typeof parsed?.line === 'string' ? parsed.line : ''
      const rawInput = line.replace(/^\/designmap\s*/u, '')
      try {
        // Full command path: the transport strips `op`, the domain guard refuses model fields.
        const answer = await command({ rawInput, agent: null })
        console.log(`200 /stub/command ${rawInput.slice(0, 80)} -> ${answer.kind}`)
        return remoteResult(response, answer)
      } catch (error) {
        console.log(`500 /stub/command ${String(error?.message ?? error)}`)
        return json(response, 200, { ok: false, error: { code: 'command_failed', message: String(error?.message ?? error) } })
      }
    }

    if (pathname === '/stub/list') {
      const requested = url.searchParams.get('set')
      const set = requested === 'm0' || requested === 'empty' ? requested : 'fixture'
      const dir = url.searchParams.get('dir') ?? ''
      if (dir !== 'designmap/out') return json(response, 200, { ok: true, value: { entries: [] } })
      const index = await readIndex(set)
      const entries = index.views.map((entry) => ({ name: `${entry.viewId}.scene.json`, kind: 'file', path: `designmap/out/${entry.viewId}.scene.json` }))
      console.log(`200 /stub/list set=${set} entries=${entries.length}`)
      return json(response, 200, { ok: true, value: { entries } })
    }

    if (pathname === '/stub/read') {
      const requested = url.searchParams.get('set')
      const set = requested === 'm0' || requested === 'empty' ? requested : 'fixture'
      const path = url.searchParams.get('path') ?? ''
      if (!path.startsWith('designmap/out/')) {
        console.log(`200 /stub/read missing ${path}`)
        return fail(response, 'workspace-file/not-found', `no entry at "${path}"`, { path })
      }
      const name = path.slice('designmap/out/'.length)
      if (!/^[A-Za-z0-9._-]+\.scene\.json$/.test(name)) return fail(response, 'workspace-file/not-found', `no entry at "${path}"`, { path })
      const text = await readFile(join(SCENES, set, name), 'utf8')
      console.log(`200 /stub/read ${set}/${name} ${Buffer.byteLength(text)}B`)
      return json(response, 200, {
        ok: true,
        value: { text, absolutePath: `/virtual/${set}/${name}`, version: 'harness-v1', offset: 1, lines: text.split('\n').length, eof: true },
      })
    }

    if (pathname === '/stub/stat') {
      const raw = url.searchParams.get('path') ?? ''
      const target = resolve(REPO, raw)
      console.log(`/stub/stat ${raw} -> ${target}`)
      if (!inside(REPO, target)) return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      try {
        const info = await stat(target)
        if (!info.isFile()) throw new Error('not a file')
        return json(response, 200, { ok: true, value: { absolutePath: target, version: 'harness-stat', bytes: info.size } })
      } catch {
        return fail(response, 'workspace-file/not-found', `no entry at "${raw}"`, { path: raw })
      }
    }

    if (pathname === '/stub/open') {
      const raw = url.searchParams.get('path') ?? ''
      console.log(`200 /stub/open ${raw}`)
      return json(response, 200, { ok: true, value: { opened: true } })
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
    console.log(`404 ${pathname}`)
  } catch (error) {
    console.error(error)
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error?.message ?? error))
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`designmap M1 harness: http://127.0.0.1:${PORT}/?set=fixture`)
})
