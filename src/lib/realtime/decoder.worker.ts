/// <reference lib="webworker" />
import { decodeFrame } from "./decode";
import type { WorkerRequest, WorkerResponse } from "./frameDecoder";

/**
 * Stateless decode worker: one raw frame in, one DecodeResult out.
 * Connection, subscription and backpressure stay on the main thread.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, raw } = event.data;
  const response: WorkerResponse = { id, result: decodeFrame(raw) };
  ctx.postMessage(response);
};
