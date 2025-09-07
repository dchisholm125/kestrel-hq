import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

describe('refactor tools (smoke)', () => {
  const root = path.resolve(__dirname, '../../../..')
  const reports = path.join(root, 'reports')

  it('collectUnused writes a valid JSON report (dry run)', async () => {
    // ensure input reports exist
    fs.mkdirSync(reports, { recursive: true })
    fs.writeFileSync(path.join(reports, 'tsprune.json'), JSON.stringify({}))
    fs.writeFileSync(path.join(reports, 'depcruise.json'), JSON.stringify({ modules: [] }))
  // run collector via ts-node in a subprocess
    execSync('node -r ts-node/register/transpile-only tools/refactor/collectUnused.ts', { cwd: root, env: { ...process.env, TS_NODE_PROJECT: 'tools/tsconfig.tools.json' } })
    const outPath = path.join(reports, 'unused-aggregate.json')
    expect(fs.existsSync(outPath)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'))
    expect(parsed).toHaveProperty('summary')
  })
})
