import { defineTask } from '@a5c-ai/babysitter-sdk'

const shell = (id, code) => defineTask(id, () => ({
  kind: 'shell',
  title: id,
  shell: { command: 'node', args: ['-e', code] },
}))

const even = shell('even-check', 'process.stdout.write("even")')
const odd = shell('odd-check', 'process.stdout.write("odd")')
const a = shell('par-a', 'process.stdout.write("A")')
const b = shell('par-b', 'process.stdout.write("B")')
const failing = shell('will-fail', 'process.exit(3)')

export async function process(inputs, ctx) {
  const out = []
  const first = String(await ctx.task(even, {}))
  out.push(['branch-input', first])
  const branch = first.includes('even') ? odd : even
  out.push(['branch-result', String(await ctx.task(branch, {}))])
  for (let i = 0; i < 2; i += 1) out.push([`loop-${i}`, String(await ctx.task(a, {}))])
  const [pa, pb] = await ctx.parallel.all([() => ctx.task(a, {}), () => ctx.task(b, {})])
  out.push(['parallel', `${String(pa)}+${String(pb)}`])
  try {
    out.push(['fail-result', String(await ctx.task(failing, {}))])
  } catch (error) {
    out.push(['fail-threw', String(error?.message ?? error).slice(0, 90)])
  }
  return { out }
}
