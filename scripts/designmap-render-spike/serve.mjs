/**
 * Local static server for the spike only. No CDN, no host proxy, no writes.
 * Every asset the page loads is served from public/ on 127.0.0.1.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, 'public')
const PORT = Number(process.env.SPIKE_PORT ?? 4319)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const target = normalize(join(ROOT, pathname))
  if (!target.startsWith(ROOT + sep)) {
    response.writeHead(403).end('forbidden')
    return
  }
  try {
    const info = await stat(target)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(target)
    response.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': body.byteLength,
    })
    response.end(body)
    console.log(`200 ${request.method} ${url.pathname}${url.search} ${body.byteLength}B`)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
    console.log(`404 ${request.method} ${url.pathname}`)
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`spike: http://127.0.0.1:${PORT}/`)
})
