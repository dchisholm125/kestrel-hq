import { Registry } from 'prom-client'
import * as metrics from '../../src/utils/metrics'

describe('metrics wrapper', () => {
  let reg: Registry

  beforeEach(() => {
    reg = new Registry()
    metrics.setRegistry(reg)
  })

  test('transition-counters: advancing intents increments appropriate labels', async () => {
    // simulate two transitions across edges
    metrics.countTransition('RECEIVED', 'VALIDATED')
    metrics.countTransition('VALIDATED', 'CRAFTED')

    const content = await reg.getMetricsAsJSON()
  const tc = content.find(m => m.name === 'transition_counter')
  expect(tc).toBeDefined()
  // prom-client JSON exposes samples in `values`
  const values = tc!.values
  const sample1 = values.find(s => s.labels.from === 'RECEIVED' && s.labels.to === 'VALIDATED')
  const sample2 = values.find(s => s.labels.from === 'VALIDATED' && s.labels.to === 'CRAFTED')
  expect(sample1).toBeDefined()
  expect(sample1!.value).toBe(1)
  expect(sample2).toBeDefined()
  expect(sample2!.value).toBe(1)
  })

  test('rejection-counter: reject at VALIDATED with reason_code', async () => {
    metrics.countRejection('VALIDATED', 'OUT_OF_FUNDS')
    const content = await reg.getMetricsAsJSON()
  const rc = content.find(m => m.name === 'rejection_counter')
  expect(rc).toBeDefined()
  const sample = rc!.values.find(s => s.labels.stage === 'VALIDATED' && s.labels.reason === 'OUT_OF_FUNDS')
  expect(sample).toBeDefined()
  expect(sample!.value).toBe(1)
  })

  test('stage-histogram: timer records one sample', async () => {
    metrics.observeStage('VALIDATED', 123)
    const content = await reg.getMetricsAsJSON()
  const h = content.find(m => m.name === 'stage_histogram')
  expect(h).toBeDefined()
  // histogram metrics include values for the label; find any value for this stage with positive value
  const val = h!.values.find(s => s.labels.stage === 'VALIDATED' && s.value > 0)
  expect(val).toBeDefined()
  })

  test('e2e-histogram: RECEIVED -> REJECTED records terminal REJECTED', async () => {
    // simulate e2e where terminal outcome is REJECTED
    metrics.observeE2E('REJECTED', 200)
    const content = await reg.getMetricsAsJSON()
  const e = content.find(m => m.name === 'e2e_histogram')
  expect(e).toBeDefined()
  const val = e!.values.find(s => s.labels.terminal === 'REJECTED' && s.value > 0)
  expect(val).toBeDefined()
  })
})
