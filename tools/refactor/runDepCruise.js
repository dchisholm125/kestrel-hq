/**
 * runDepCruise.js
 * Purpose: Run dependency-cruiser across the monorepo and write reports/depcruise.json.
 * Safety: Read-only analysis.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function main() {
  const root = path.resolve(__dirname, '..', '..')
  const reportsDir = path.join(root, 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const configPath = path.join(root, '.dependency-cruiser.cjs')
  // Find package-level tsconfig files. If exactly one exists, pass it; otherwise omit --ts-config
  const pkgDir = path.join(root, 'packages')
  let tsConfigs = []
  if (fs.existsSync(pkgDir)) {
    tsConfigs = fs.readdirSync(pkgDir)
      .map(n => path.join(pkgDir, n))
      .map(p => path.join(p, 'tsconfig.json'))
      .filter(p => fs.existsSync(p))
  }
  const argsBase = ['--include-only', '^packages', '--output-type', 'json']
  const args = tsConfigs.length === 1 ? ['--include-only', '^packages', '--ts-config', tsConfigs[0], '--output-type', 'json'] : argsBase
  if (tsConfigs.length > 1) console.warn('[refactor] multiple package tsconfigs found; running depcruise without --ts-config')
  if (fs.existsSync(configPath)) {
    args.unshift('--config', configPath)
  }
  const out = execFileSync('npx', ['--yes', 'depcruise', ...args, 'packages'], { cwd: root, encoding: 'utf8' })
  fs.writeFileSync(path.join(reportsDir, 'depcruise.json'), out)
  console.log('[refactor] dependency-cruiser report written to reports/depcruise.json')
}

if (require.main === module) main()
