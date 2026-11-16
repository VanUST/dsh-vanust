/**
 * Seeded 25-node view for the NFR-3 budget: layout + merge + lint must finish inside
 * 1500 ms and the logger must carry `layout.done {ms, nodes}`.
 *
 * The graph is deliberately boring (a chain plus two cross edges) so the measured time
 * is the pipeline's, not a pathological fan-in of ELK.
 */
const TYPES = ['frontend', 'service', 'worker', 'datastore', 'queue', 'external']

export function perfModel(count = 25) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `svc.n${String(index).padStart(2, '0')}`,
    type: TYPES[index % TYPES.length],
    label: `Service ${index}`,
    group: index < 5 ? 'grp.core' : null,
    source: null,
  }))
  const edges = []
  for (let index = 0; index + 1 < count; index += 1) {
    edges.push({
      id: `e.n${String(index).padStart(2, '0')}.n${String(index + 1).padStart(2, '0')}`,
      from: nodes[index].id,
      to: nodes[index + 1].id,
      kind: 'sync',
      label: `call ${index}`,
    })
  }
  edges.push({ id: 'e.n00.n05', from: nodes[0].id, to: nodes[5].id, kind: 'async', label: 'fan out' })
  edges.push({ id: 'e.n02.n07', from: nodes[2].id, to: nodes[7].id, kind: 'data', label: 'read' })
  return {
    schemaVersion: 1,
    groups: [{ id: 'grp.core', label: 'Core' }],
    nodes,
    edges,
  }
}

export const perfViews = {
  schemaVersion: 1,
  views: [
    { id: 'v.flow', title: 'Seeded 25-node view', level: 'flow', direction: 'LR', include: [], parent: null },
  ],
}

export const perfFixture = { model: perfModel(), views: perfViews }
