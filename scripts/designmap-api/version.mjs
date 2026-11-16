/**
 * Read the installed version of a dependency without assuming npm's flat layout.
 *
 * `import.meta.resolve(pkg)` gives the package entry (following pnpm's symlinks into
 * `.pnpm`), then we walk up to the manifest whose `name` matches. Reading a hard-coded
 * `./node_modules/<pkg>/package.json` breaks under pnpm's isolated linker.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function packageDir(pkg) {
  let directory = dirname(fileURLToPath(import.meta.resolve(pkg)))
  for (let depth = 0; depth < 12; depth += 1) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (parsed.name === pkg) return directory
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`cannot locate the installed directory of ${pkg}`)
}

export function installedVersion(pkg) {
  let directory = dirname(fileURLToPath(import.meta.resolve(pkg)))
  for (let depth = 0; depth < 12; depth += 1) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (parsed.name === pkg) return parsed.version
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`cannot locate the installed manifest of ${pkg}`)
}
