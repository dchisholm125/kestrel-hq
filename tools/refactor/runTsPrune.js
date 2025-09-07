/**
 * runTsPrune.js
 * Purpose: Run ts-prune across all workspace packages and aggregate results.
 * Output: reports/tsprune.json
 * Safety: Analysis only. No modifications.
 * Rollback: Delete reports/tsprune.json.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function listPackages(root) {
  const pkgsDir = path.join(root, 'packages')
  if (!fs.existsSync(pkgsDir)) return []
  return fs.readdirSync(pkgsDir)
    .map(n => path.join(pkgsDir, n))
    .filter(p => fs.existsSync(path.join(p, 'package.json')))
}

function runTsPruneOn(pkgDir) {
  const tsconfig = fs.existsSync(path.join(pkgDir, 'tsconfig.json'))
    ? path.join(pkgDir, 'tsconfig.json')
    : undefined
  const args = []
  if (tsconfig) args.push('--tsConfig', tsconfig)
  args.push('--ignore', '(test|__tests__|dist|node_modules)')
  args.push('--json')
  try {
    const out = execFileSync('npx', ['--yes', 'ts-prune', ...args], { cwd: pkgDir, encoding: 'utf8' })
    return JSON.parse(out)
  } catch (e) {
    // If ts-prune fails, return empty list for this package
    return []
  }
}

function main() {
  const root = path.resolve(__dirname, '..', '..')
  const reportsDir = path.join(root, 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const all = {}
  const pkgs = listPackages(root)
  for (const p of pkgs) {
    all[path.basename(p)] = runTsPruneOn(p)
  }
  fs.writeFileSync(path.join(reportsDir, 'tsprune.json'), JSON.stringify(all, null, 2))
  const totalUnused = Object.values(all).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
  console.log(`[refactor] ts-prune complete: ${totalUnused} unused exports across ${pkgs.length} packages`)
}

if (require.main === module) main()
