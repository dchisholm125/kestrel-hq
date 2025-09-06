export interface MetricsStats {
  submissionsReceived: number
  submissionsAccepted: number
  submissionsRejected: number
  acceptanceRate: number
  averageProcessingTimeMs: number
  p95ProcessingTimeMs: number | null
  countProcessingSamples: number
}

import client from 'prom-client'

export class MetricsTracker {
  private static instance: MetricsTracker
  private submissionsReceived = 0
  private submissionsAccepted = 0
  private submissionsRejected = 0
  private processingTimes: number[] = []

  // Prometheus metrics
  private intentsCounter: client.Counter<string>
  private errorsCounter: client.Counter<string>

  // domain-specific metrics
  public intentDecisionLatency: client.Histogram<string>
  public stageLatency: client.Histogram<string>
  public queueDepth: client.Gauge<string>
  public inflightByKey: client.Gauge<string>
  public rejects: client.Counter<string>
  public throttles: client.Counter<string>
  public relaySubmitLatency: client.Histogram<string>
  public relayInclusion: client.Counter<string>
  public relayRejections: client.Counter<string>
  public idempotencyHits: client.Counter<string>
  public bundleEvNetWei: client.Gauge<string>
  public realizedPnlWei: client.Gauge<string>

  private constructor() {
    // create or reuse registry default
    const register = client.register
    client.collectDefaultMetrics({ register })

    this.intentsCounter = new client.Counter({ name: 'kestrel_intents_total', help: 'Total intents', labelNames: ['decision'] })
    this.errorsCounter = new client.Counter({ name: 'kestrel_errors_total', help: 'Total errors', labelNames: ['reason_code'] })

    // 1) End-to-end decision latency
    this.intentDecisionLatency = new client.Histogram({
      name: 'kestrel_intent_decision_latency_ms',
      help: 'Intake to first decision latency (ms)',
      buckets: [1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500]
    })

    // 2) Per-stage latencies
    this.stageLatency = new client.Histogram({
      name: 'kestrel_stage_latency_ms',
      help: 'Latency per conveyor stage (ms)',
      labelNames: ['stage'],
      buckets: [0.2, 0.5, 1, 2, 5, 10, 20, 35, 50, 75, 100, 150]
    })

    // 3) Queue depth / inflight
    this.queueDepth = new client.Gauge({ name: 'kestrel_queue_depth', help: 'Pending intents in conveyor queue' })
    this.inflightByKey = new client.Gauge({ name: 'kestrel_inflight_intents', help: 'In-flight intents per key', labelNames: ['key_id'] })

    // 4) Reject reasons & throttles
    this.rejects = new client.Counter({ name: 'kestrel_rejects_total', help: 'Rejects by reason code', labelNames: ['reason_code'] })
    this.throttles = new client.Counter({ name: 'kestrel_throttled_total', help: 'Throttled intents (token bucket)', labelNames: ['key_id'] })

    // 5) Relay submission & inclusion
    this.relaySubmitLatency = new client.Histogram({ name: 'kestrel_relay_submit_latency_ms', help: 'Relay submit round-trip (ms)', labelNames: ['relay'], buckets: [1,2,5,10,20,35,50,75,100,150,200] })
    this.relayInclusion = new client.Counter({ name: 'kestrel_relay_inclusions_total', help: 'Bundles included by relay', labelNames: ['relay'] })
    this.relayRejections = new client.Counter({ name: 'kestrel_relay_rejections_total', help: 'Relay rejections by reason', labelNames: ['relay','reason'] })

    // 6) Idempotency
    this.idempotencyHits = new client.Counter({ name: 'kestrel_idempotency_hits_total', help: 'Repeated requests returning cached decision' })

    // 7) Economics
    this.bundleEvNetWei = new client.Gauge({ name: 'kestrel_bundle_ev_net_wei', help: 'Simulated EV net of gas (wei)' })
    this.realizedPnlWei = new client.Gauge({ name: 'kestrel_realized_pnl_wei', help: 'Realized PnL for last included bundle (wei)' })
  }

  static getInstance(): MetricsTracker {
    if (!MetricsTracker.instance) MetricsTracker.instance = new MetricsTracker()
    return MetricsTracker.instance
  }

  incrementReceived(count = 1) { this.submissionsReceived += count }
  incrementAccepted(count = 1) { this.submissionsAccepted += count; this.intentsCounter.inc({ decision: 'accepted' }, count) }
  incrementRejected(count = 1) { this.submissionsRejected += count; this.intentsCounter.inc({ decision: 'rejected' }, count) }
  recordError(reason_code: string, count = 1) { this.errorsCounter.inc({ reason_code }, count) }
  recordProcessingTime(ms: number) { if (ms >= 0 && Number.isFinite(ms)) this.processingTimes.push(ms) }

  // New helpers
  observeDecisionLatency(ms: number) { if (ms >= 0) this.intentDecisionLatency.observe(ms) }
  observeStage(stage: string, ms: number) { if (ms >= 0) this.stageLatency.labels(stage).observe(ms) }
  setQueueDepth(n: number) { this.queueDepth.set(n) }
  setInflightByKey(key_id: string, n: number) { this.inflightByKey.labels(key_id).set(n) }
  // convenience helpers to increment/decrement inflight counts
  incInflightByKey(key_id: string, n = 1) { this.inflightByKey.labels(key_id).inc(n) }
  decInflightByKey(key_id: string, n = 1) { try { this.inflightByKey.labels(key_id).dec(n) } catch (e) { /* ignore */ } }
  incReject(reason_code: string, count = 1) { this.rejects.inc({ reason_code }, count); this.incrementRejected(count) }
  incThrottle(key_id: string, count = 1) { this.throttles.inc({ key_id }, count) }
  observeRelaySubmit(relay: string, ms: number) { if (ms >= 0) this.relaySubmitLatency.labels(relay).observe(ms) }
  incRelayInclusion(relay: string, count = 1) { this.relayInclusion.inc({ relay }, count) }
  incRelayRejection(relay: string, reason: string, count = 1) { this.relayRejections.inc({ relay, reason }, count) }
  incIdempotencyHit(count = 1) { this.idempotencyHits.inc(count) }
  setBundleEvNetWei(val: number) { this.bundleEvNetWei.set(val) }
  setRealizedPnlWei(val: number) { this.realizedPnlWei.set(val) }

  getStats(): MetricsStats {
    const total = this.submissionsReceived || 1
    const acceptanceRate = this.submissionsAccepted / total
    const avg = this.processingTimes.length
      ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
      : 0
    let p95: number | null = null
    if (this.processingTimes.length) {
      const sorted = [...this.processingTimes].sort((a,b)=>a-b)
      const idx = Math.floor(sorted.length * 0.95) - 1
      p95 = sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
    }
    return {
      submissionsReceived: this.submissionsReceived,
      submissionsAccepted: this.submissionsAccepted,
      submissionsRejected: this.submissionsRejected,
      acceptanceRate,
      averageProcessingTimeMs: Number(avg.toFixed(2)),
      p95ProcessingTimeMs: p95 !== null ? Number(p95.toFixed(2)) : null,
      countProcessingSamples: this.processingTimes.length,
    }
  }

  getPromMetrics() { return client.register.metrics() }
}

export default MetricsTracker