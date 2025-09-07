import { Registry, Counter, Histogram, Gauge } from 'prom-client'

let registry: Registry
let transitionCounter: Counter<string>
let rejectionCounter: Counter<string>
let stageHistogram: Histogram<string>
let e2eHistogram: Histogram<string>
let queueGauge: Gauge<string>

function initMetrics(reg?: Registry) {
  registry = reg ?? new Registry()

  // create metrics and register to the registry
  transitionCounter = new Counter({
    name: 'transition_counter',
    help: 'Counts state transitions',
    labelNames: ['from', 'to'],
    registers: [registry]
  })

  rejectionCounter = new Counter({
    name: 'rejection_counter',
    help: 'Counts rejections by stage and reason',
    labelNames: ['stage', 'reason'],
    registers: [registry]
  })

  stageHistogram = new Histogram({
    name: 'stage_histogram',
    help: 'Duration observed at stages (ms)',
    labelNames: ['stage'],
    buckets: [10, 50, 100, 200, 500, 1000, 5000],
    registers: [registry]
  })

  e2eHistogram = new Histogram({
    name: 'e2e_histogram',
    help: 'End-to-end latency by terminal outcome (ms)',
    labelNames: ['terminal'],
    buckets: [10, 50, 100, 200, 500, 1000, 5000],
    registers: [registry]
  })

  queueGauge = new Gauge({
    name: 'queue_depth',
    help: 'Queue depth',
    registers: [registry]
  })
}

// initialize default metrics on module load
initMetrics()

export function setRegistry(reg: Registry) {
  initMetrics(reg)
}

export function countTransition(from: string, to: string) {
  transitionCounter.labels({ from, to }).inc()
}

export function countRejection(stage: string, reason: string) {
  rejectionCounter.labels({ stage, reason }).inc()
}

export function observeStage(stage: string, ms: number) {
  stageHistogram.labels({ stage }).observe(ms)
}

export function observeE2E(terminal: string, ms: number) {
  e2eHistogram.labels({ terminal }).observe(ms)
}

export function setQueueDepth(n: number) {
  queueGauge.set(n)
}

export async function metricsHandler(req: any, res: any) {
  try {
    res.setHeader('Content-Type', registry.contentType || 'text/plain; version=0.0.4')
    const body = await registry.metrics()
    res.statusCode = 200
    res.end(body)
  } catch (e) {
    res.statusCode = 500
    res.end('error')
  }
}

export { registry }
