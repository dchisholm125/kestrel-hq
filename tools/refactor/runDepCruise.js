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
  const args = ['--include-only', '^packages', '--ts-config', 'packages/*/tsconfig.json', '--output-type', 'json']
  if (fs.existsSync(configPath)) {
    args.unshift('--config', configPath)
  }
  const out = execFileSync('npx', ['--yes', 'depcruise', ...args, 'packages'], { cwd: root, encoding: 'utf8' })
  fs.writeFileSync(path.join(reportsDir, 'depcruise.json'), out)
  console.log('[refactor] dependency-cruiser report written to reports/depcruise.json')
}

if (require.main === module) main()
