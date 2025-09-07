import fs from 'fs'
import path from 'path'

// Re-implement a tiny parser like load-fixtures to unit test malformed handling.
function parseJsonl(str: string) {
  const out: any[] = []
  const lines = str.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch (e) {
      // pretend to log a warning; in real script we console.warn
    }
  }
  return out
}

describe('fixtures parser', () => {
  it('skips malformed lines gracefully', () => {
    const data = `{"ok":1}\nnot-json\n{"ok":2}`
    const rows = parseJsonl(data)
    expect(rows.length).toBe(2)
    expect(rows[0].ok).toBe(1)
    expect(rows[1].ok).toBe(2)
  })
})
