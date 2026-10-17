import { describe, expect, it } from 'vitest'
import {
  RealtimeCanaryProbe,
  type CanaryProbeResult,
} from './canaryProbe'

describe('RealtimeCanaryProbe', () => {
  it('measures connectDurationMs and timeToFirstEventMs and returns exitCode 0 when healthy', async () => {
    let clock = 1_000
    const metrics: CanaryProbeResult[] = []

    const probe = new RealtimeCanaryProbe({
      endpointUrl: 'wss://realtime.refract.finance/ws',
      environment: 'production',
      transport: 'websocket',
      topic: 'oracle_update',
      now: () => clock,
      onEmitMetric: (m) => metrics.push(m),
      createSession: () => ({
        connect: async () => {
          clock += 85
        },
        authenticate: async () => {
          clock += 15
        },
        subscribeAndWaitForFirstEvent: async () => {
          clock += 120
          return { price: 1.0 }
        },
        disconnect: () => {},
      }),
    })

    const res = await probe.runOnce()
    expect(res.status).toBe('healthy')
    expect(res.exitCode).toBe(0)
    expect(res.connectDurationMs).toBe(85)
    expect(res.timeToFirstEventMs).toBe(120)
    expect(res.endpointHost).toBe('realtime.refract.finance')
    expect(metrics).toHaveLength(1)
  })

  it('attributes failure stage, returns exitCode 1, and alerts only after consecutive failure threshold', async () => {
    const alerts: CanaryProbeResult[] = []
    let shouldFail = true

    const probe = new RealtimeCanaryProbe({
      endpointUrl: 'wss://realtime.refract.finance/ws',
      alertFailureThreshold: 2,
      onAlert: (r) => alerts.push(r),
      createSession: () => ({
        connect: async () => {},
        authenticate: async () => {
          if (shouldFail) {
            throw new Error('token_endpoint_401')
          }
        },
        subscribeAndWaitForFirstEvent: async () => ({}),
        disconnect: () => {},
      }),
    })

    // 1st failure: exitCode 1, failureStage 'auth', but no alert yet (threshold=2)
    const first = await probe.runOnce()
    expect(first.status).toBe('failed')
    expect(first.exitCode).toBe(1)
    expect(first.failureStage).toBe('auth')
    expect(first.alertTriggered).toBe(false)
    expect(alerts).toHaveLength(0)

    // 2nd consecutive failure -> triggers alert
    const second = await probe.runOnce()
    expect(second.consecutiveFailures).toBe(2)
    expect(second.alertTriggered).toBe(true)
    expect(alerts).toHaveLength(1)

    // Recovery resets consecutiveFailures to 0
    shouldFail = false
    const recovered = await probe.runOnce()
    expect(recovered.status).toBe('healthy')
    expect(recovered.consecutiveFailures).toBe(0)
  })
})
