export interface MetricsStats {
  submissionsReceived: number
  submissionsAccepted: number
  submissionsRejected: number
  acceptanceRate: number
  averageProcessingTimeMs: number
  p95ProcessingTimeMs: number | null
  countProcessingSamples: number
}

export class MetricsTracker {
  private static instance: MetricsTracker
  private submissionsReceived = 0
  private submissionsAccepted = 0
  private submissionsRejected = 0
  private processingTimes: number[] = []

  private constructor() {}

  static getInstance(): MetricsTracker {
    if (!MetricsTracker.instance) MetricsTracker.instance = new MetricsTracker()
    return MetricsTracker.instance
  }

  incrementReceived(count = 1) { this.submissionsReceived += count }
  incrementAccepted(count = 1) { this.submissionsAccepted += count }
  incrementRejected(count = 1) { this.submissionsRejected += count }
  recordProcessingTime(ms: number) { if (ms >= 0 && Number.isFinite(ms)) this.processingTimes.push(ms) }

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
}

export default MetricsTracker