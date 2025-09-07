import fs from 'fs'
import path from 'path'

function readJsonl(file: string) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
  return lines.filter(Boolean).map(l => JSON.parse(l))
}

describe('fixture-shape', () => {
  const dir = path.resolve(__dirname, '../../fixtures')
  const files = ['green.jsonl', 'policy_reject.jsonl', 'replay.jsonl']
  for (const f of files) {
    it(`${f} monotonic state order and tail`, () => {
      const rows = readJsonl(path.join(dir, f))
      expect(rows.length).toBeGreaterThan(0)
      let lastTs = 0
      for (const r of rows) {
        const ts = Date.parse(r.ts)
        expect(ts).toBeGreaterThanOrEqual(lastTs)
        lastTs = ts
      }
      const tail = rows[rows.length - 1]
      if (f === 'green.jsonl') expect(tail.to_state).toBe('QUEUED')
      if (f === 'policy_reject.jsonl') expect(tail.to_state).toBe('REJECTED')
      if (f === 'replay.jsonl') expect(tail.to_state).toBe('REJECTED')
      if (tail.to_state === 'REJECTED') {
        expect(typeof tail.reason_code).toBe('string')
      }
    })
  }
})

describe('manifest-valid', () => {
  it('contains files and counts', () => {
    const dir = path.resolve(__dirname, '../../fixtures')
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    expect(Array.isArray(manifest.files)).toBe(true)
    const byName: Record<string, any> = {}
    for (const f of manifest.files) byName[f.name] = f
    expect(byName['green.jsonl'].count).toBe(5)
    expect(byName['policy_reject.jsonl'].count).toBe(5)
    expect(byName['replay.jsonl'].count).toBe(2)
  })
})
