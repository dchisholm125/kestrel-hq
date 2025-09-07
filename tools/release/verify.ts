#!/usr/bin/env ts-node
/**
 * release:verify — Build, pack, and sandbox-install all publishable packages.
 * Console logs steps and writes reports/publish-verify.jsonl.
 */
// Use CJS-style requires for ts-node compatibility across Node versions
const { execSync } = require('child_process') as typeof import('child_process')
const fs = require('fs') as typeof import('fs')
const path = require('path') as typeof import('path')

const REPO = path.resolve(__dirname, '../..')
const PACKAGES_DIR = path.join(REPO, 'packages')
const REPORTS = path.join(REPO, 'reports')
const LOG = path.join(REPORTS, 'publish-verify.jsonl')

function sh(cmd: string, cwd = REPO) {
  execSync(cmd, { stdio: 'inherit', cwd })
}

function listPublishables(): string[] {
  const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory())
    .map(e => path.join(PACKAGES_DIR, e.name))
    .filter(dir => {
      const pj = path.join(dir, 'package.json')
      if (!fs.existsSync(pj)) return false
      const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
      return pkg.private === false
    })
}

function writeLog(line: any) {
  fs.mkdirSync(REPORTS, { recursive: true })
  fs.appendFileSync(LOG, JSON.stringify(line) + '\n')
}

function main() {
  const pkgs = listPublishables()
  console.log(`Building packages… (${pkgs.length})`)
  sh('pnpm -r --filter "./packages/*" build')

  console.log('Packing tarballs…')
  sh('pnpm -r --filter "./packages/*" pack')

  console.log('Installing in sandbox…')
  const sandbox = path.join(REPO, 'tmp-consumer')
  fs.rmSync(sandbox, { recursive: true, force: true })
  fs.mkdirSync(sandbox, { recursive: true })
  // Create a minimal package.json to allow pnpm add
  const sandboxPkg = {
    name: 'tmp-consumer',
    private: true,
    version: '0.0.0',
  }
  fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify(sandboxPkg, null, 2))

  // Resolve tarball paths for all publishable packages
  const entries = pkgs.map(dir => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const name: string = pkg.name
    const version: string = pkg.version
    const deps: string[] = Object.keys({ ...(pkg.dependencies||{}), ...(pkg.peerDependencies||{}) })
    const tgzName = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
    let tgzPath = path.join(dir, tgzName)
    if (!fs.existsSync(tgzPath)) tgzPath = path.join(REPO, tgzName)
    const built = fs.existsSync(path.join(dir, 'dist'))
    const packed = fs.existsSync(tgzPath)
    return { dir, name, version, tgzPath, built, packed, deps }
  })

  // Topologically sort by internal deps (@kestrel-hq/*)
  const nameToEntry = new Map(entries.map(e => [e.name, e]))
  const inDegree = new Map<string, number>()
  const graph = new Map<string, string[]>()
  for (const e of entries) {
    const internalDeps = e.deps.filter(d => d.startsWith('@kestrel-hq/'))
    inDegree.set(e.name, (inDegree.get(e.name) || 0))
    for (const d of internalDeps) {
      if (!nameToEntry.has(d)) continue
      graph.set(d, [...(graph.get(d) || []), e.name])
      inDegree.set(e.name, (inDegree.get(e.name) || 0) + 1)
    }
  }
  const queue: string[] = []
  for (const [n, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(n)
  }
  const topo: string[] = []
  while (queue.length) {
    const n = queue.shift()!
    topo.push(n)
    for (const m of graph.get(n) || []) {
      const d = (inDegree.get(m) || 0) - 1
      inDegree.set(m, d)
      if (d === 0) queue.push(m)
    }
  }
  const ordered = topo.length === entries.length ? topo : entries.map(e => e.name)

  // Configure overrides so internal deps resolve to local tarballs
  const pkgJsonPath = path.join(sandbox, 'package.json')
  const sandboxPkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  const overrides: Record<string, string> = {}
  for (const e of entries) {
    if (e.packed) overrides[e.name] = `file:${e.tgzPath}`
  }
  sandboxPkgJson.pnpm = { ...(sandboxPkgJson.pnpm || {}), overrides: { ...(sandboxPkgJson.pnpm?.overrides || {}), ...overrides } }
  fs.writeFileSync(pkgJsonPath, JSON.stringify(sandboxPkgJson, null, 2))

  // Install in topo order one-by-one so internal deps are available first
  for (const name of ordered) {
    const e = nameToEntry.get(name)!
    try {
      if (e.packed) {
        sh(`pnpm add "${e.tgzPath}"`, sandbox)
      }
    } catch (err) {
      // continue; we'll log status below
    }
  }

  for (const e of entries) {
    const nmPath = path.join(sandbox, 'node_modules', ...e.name.split('/'))
    const installed = fs.existsSync(nmPath)
    writeLog({ ts: new Date().toISOString(), package: e.name, version: e.version, built: e.built, packed: e.packed, sandboxInstalled: installed, tgz: e.packed ? e.tgzPath : undefined })
  }
  console.log('Installing in sandbox… ✅')
}

main()
