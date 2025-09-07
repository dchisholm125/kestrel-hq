import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

describe('applyDeletions safety (dry)', () => {
  const root = path.resolve(__dirname, '../../../..')
  const reports = path.join(root, 'reports')
  const pkgDir = path.join(root, 'packages', 'protocol-server')

  beforeAll(() => {
    fs.mkdirSync(reports, { recursive: true })
    // write depcruise with one orphan that is also protected (src/index.ts)
    const depcruise = { modules: [ { source: path.relative(root, path.join(pkgDir, 'src', 'index.ts')), orphan: true } ] }
    fs.writeFileSync(path.join(reports, 'depcruise.json'), JSON.stringify(depcruise))
    // aggregate includes same orphan
    const agg = { tsprune: {}, orphans: depcruise.modules.filter(m => m.orphan).map(m => m.source) }
    fs.writeFileSync(path.join(reports, 'unused-aggregate.json'), JSON.stringify(agg))
  })

  it('does not propose deleting protected entry files', () => {
    // run apply in plan-only mode
    execSync('node -r ts-node/register/transpile-only tools/refactor/applyDeletions.ts', {
      cwd: root,
      env: { ...process.env, TS_NODE_PROJECT: 'tools/tsconfig.tools.json' }
    })
    const deletionsPath = path.join(reports, 'deletions.jsonl')
    const content = fs.existsSync(deletionsPath) ? fs.readFileSync(deletionsPath, 'utf8') : ''
    // should not contain src/index.ts
    expect(content.includes('src/index.ts')).toBe(false)
  })
})
