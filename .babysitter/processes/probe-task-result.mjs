import { defineTask } from '@a5c-ai/babysitter-sdk'

const probe = defineTask('probe-shell', () => ({
  kind: 'shell',
  title: 'probe shell result shape',
  shell: { command: 'node', args: ['-e', 'process.stdout.write("PROBE-OUT")'] },
}))

export async function process(inputs, ctx) {
  const value = await ctx.task(probe, {})
  let json = null
  try { json = JSON.parse(JSON.stringify(value)) } catch { json = String(value) }
  return {
    type: typeof value,
    isNull: value === null,
    keys: value !== null && typeof value === 'object' ? Object.keys(value) : null,
    json,
  }
}
