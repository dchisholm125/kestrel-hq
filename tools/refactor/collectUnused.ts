/**
 * collectUnused.ts
 * Purpose: Merge ts-prune + depcruise + grep markers (TODO_DEAD, @deprecated) into one report.
 * Output: reports/unused-aggregate.json
 * Safety: Analysis only.
 */
import fs from 'fs'
import path from 'path'

type TsPruneEntry = { file: string; identifier: string; line: number }
type DepCruise = { modules: Array<{ source: string; orphan?: boolean }> }

function readJSON<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T } catch { return fallback }
}

function grepMarkers(root: string) {
  const hits: Array<{ file: string; line: number; marker: string }> = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        if (/node_modules|dist|\.git/.test(full)) continue
        walk(full)
      } else if (/\.(ts|js|tsx|jsx)$/.test(entry)) {
        const content = fs.readFileSync(full, 'utf8')
        const markers = ['TODO_DEAD', '@deprecated']
        markers.forEach(m => {
          const idx = content.indexOf(m)
          if (idx >= 0) hits.push({ file: path.relative(root, full), line: content.slice(0, idx).split(/\n/).length, marker: m })
        })
      }
    }
  }
  walk(root)
  return hits
}

function main() {
  const root = path.resolve(__dirname, '..', '..')
  const reports = path.join(root, 'reports')
  fs.mkdirSync(reports, { recursive: true })

  const tsprune = readJSON<Record<string, TsPruneEntry[]>>(path.join(reports, 'tsprune.json'), {})
  const depcruise = readJSON<DepCruise>(path.join(reports, 'depcruise.json'), { modules: [] })
  const markers = grepMarkers(root)

  const orphans = depcruise.modules.filter(m => m.orphan).map(m => m.source)

  const aggregate = {
    summary: {
      tsprunePackages: Object.keys(tsprune).length,
      tspruneUnused: Object.values(tsprune).reduce((a, arr) => a + (arr?.length || 0), 0),
      orphans: orphans.length,
      markers: markers.length,
    },
    tsprune,
    orphans,
    markers,
  }

  fs.writeFileSync(path.join(reports, 'unused-aggregate.json'), JSON.stringify(aggregate, null, 2))
  console.log(`[refactor] aggregate: ${aggregate.summary.tspruneUnused} unused exports, ${aggregate.summary.orphans} orphan files, ${aggregate.summary.markers} markers`)
}

if (require.main === module) main()
