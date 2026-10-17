import { describe, expect, it } from 'vitest'
import {
  DOCUMENTED_TRANSPORT_DIVERGENCES,
  NormalizedParityTransportDriver,
  runCrossTransportParityMatrix,
} from '../testing/transportParityMatrix'

describe('Cross-Transport Behavioral Parity Matrix (WebSocket, SSE, Long-Poll)', () => {
  it('produces identical consumer-observable state across all 6 lifecycle scenarios for websocket, sse, and long_poll', () => {
    const report = runCrossTransportParityMatrix([
      'websocket',
      'sse',
      'long_poll',
    ])

    expect(report.executedScenariosByTransport.websocket).toHaveLength(6)
    expect(report.executedScenariosByTransport.sse).toHaveLength(6)
    expect(report.executedScenariosByTransport.long_poll).toHaveLength(6)

    for (const [scenarioName, states] of Object.entries(
      report.statesByScenario,
    )) {
      expect(
        states.sse,
        `SSE parity mismatch in scenario "${scenarioName}"`,
      ).toEqual(states.websocket)
      expect(
        states.long_poll,
        `Long-poll parity mismatch in scenario "${scenarioName}"`,
      ).toEqual(states.websocket)
    }
  })

  it('explicitly tests the documented batch-delivery divergence for long_poll vs immediate push on websocket/sse', () => {
    expect(DOCUMENTED_TRANSPORT_DIVERGENCES.length).toBeGreaterThanOrEqual(2)

    const ws = new NormalizedParityTransportDriver('websocket')
    const lp = new NormalizedParityTransportDriver('long_poll')

    ws.connect()
    lp.connect()
    ws.subscribe('oracle_update')
    lp.subscribe('oracle_update')

    const frame = {
      eventId: 'div-1',
      topic: 'oracle_update',
      sequence: 1,
      payload: { price: 1.05 },
    }
    ws.pushServerFrame(frame)
    lp.pushServerFrame(frame)

    // Before poll flush: WebSocket has delivered immediately, Long-Poll has buffered
    expect(ws.getObservableState().receivedEvents).toHaveLength(1)
    expect(lp.getObservableState().receivedEvents).toHaveLength(0)

    // After poll flush: eventual state matches identically
    lp.flushLongPollCycle()
    expect(lp.getObservableState().receivedEvents).toEqual(
      ws.getObservableState().receivedEvents,
    )
  })

  it('throws if zero transports are configured in the parity run', () => {
    expect(() => runCrossTransportParityMatrix([])).toThrow(
      /requires at least one transport/,
    )
  })
})
