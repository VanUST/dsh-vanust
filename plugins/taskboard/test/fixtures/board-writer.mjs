/*
PROOF: the board has one writer across processes and loses no row when two write at once
Behavior: this fixture is ONE real writer: it creates N tasks through the plugin's own
  createService, the same read-modify-write the panel and the tools use, against a board file
  that two processes share. The test starts two of them at once against one
  .dsh/taskboard.json and reads that file afterwards.
Fails when: the read and the write are not inside the cross-process lock, because the second
  process's rename replaces a board it read before the first process wrote its rows, and the
  first writer's tasks are gone from the file the test reads.
Production path: plugins/taskboard/taskboard.mjs (createService, mutate, withBoardLock,
  writeBoardNow).
*/

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const argv = process.argv.slice(2)
const value = (name, fallback) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback
}
const modulePath = resolve(value('--module', join(KIT, 'plugins', 'taskboard', 'taskboard.mjs')))
const dir = resolve(value('--dir', '.'))
const linksFile = resolve(value('--links', join(dir, 'links.json')))
const prefix = value('--prefix', 'writer')
const count = Number.parseInt(value('--count', '20'), 10)

const { createService } = await import(pathToFileURL(modulePath).href)
const logger = { warn() {}, info() {}, error() {} }
const service = createService({ file: join(dir, '.dsh', 'taskboard.json'), linksFile, lockWaitMs: 15000 }, logger)

for (let index = 0; index < count; index += 1) {
  const created = service.create(dir, { title: `${prefix}-${index}`, role: 'BACKEND', chatId: 'chat-1' })
  if (created?.ok === false) {
    process.stderr.write(`${prefix}: create ${index} refused: ${created.code}\n`)
    process.exit(2)
  }
}
process.stdout.write(`${prefix}: ${count} tasks created\n`)
