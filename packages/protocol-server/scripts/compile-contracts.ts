import fs from 'fs'
import path from 'path'
import solc from 'solc'

// Simple compiler script using solc-js (MVP). For production prefer Hardhat or Foundry.

const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts')
const BUILD_DIR = path.join(__dirname, '..', 'build')

interface SourceMap { [fileName: string]: { content: string } }

function gatherSources(dir: string, prefix = 'contracts'): SourceMap {
  const entries = fs.readdirSync(dir)
  const sources: SourceMap = {}
  for (const e of entries) {
    const p = path.join(dir, e)
    const rel = path.relative(path.join(__dirname, '..'), p)
    if (fs.statSync(p).isDirectory()) {
      Object.assign(sources, gatherSources(p, prefix))
    } else if (e.endsWith('.sol')) {
      sources[rel.replace(/\\/g, '/')] = { content: fs.readFileSync(p, 'utf8') }
    }
  }
  return sources
}

function compile() {
  const sources = gatherSources(CONTRACTS_DIR)
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  }
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  if (out.errors) {
    const fatal = out.errors.filter((e: any) => e.severity === 'error')
    fatal.forEach((e: any) => console.error(e.formattedMessage))
    if (fatal.length > 0) throw new Error('Compilation failed')
  }
  if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR)
  for (const file in out.contracts) {
    for (const name in out.contracts[file]) {
      const artifact = {
        abi: out.contracts[file][name].abi,
        bytecode: '0x' + out.contracts[file][name].evm.bytecode.object
      }
      fs.writeFileSync(path.join(BUILD_DIR, name + '.json'), JSON.stringify(artifact, null, 2))
      console.log('Wrote artifact', name)
    }
  }
}

compile()
