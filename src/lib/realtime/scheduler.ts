import { TOPICS, type Message, type Priority } from "./contract";
/** FIFO per class, 8:1 fairness, bounded memory, and a 4ms/64-event task budget. */
export class Scheduler {
  private queues: Record<Priority, { message: Message; at: number }[]> = { critical: [], bulk: [] };
  private pending = false;
  private streak = 0;
  private generation = 0;
  readonly metrics = { worstCriticalLatencyMs: 0, droppedCritical: 0, droppedBulk: 0 };
  constructor(
    private dispatch: (m: Message) => void,
    private activeTopics: () => number,
    private report = (ms: number) => console.debug("realtime critical worst latency ms", ms),
    private cap = 2048
  ) {}
  enqueue(message: Message) {
    if (this.activeTopics() <= 1 && !this.pending) {
      this.dispatch(message);
      return;
    }
    const priority = TOPICS[message.topic];
    const q = this.queues[priority];
    if (q.length >= this.cap) {
      this.metrics[priority === "critical" ? "droppedCritical" : "droppedBulk"]++;
      return;
    }
    q.push({ message, at: performance.now() });
    if (!this.pending) {
      this.pending = true;
      const generation = this.generation;
      // Yield past the current message task so a wire burst can actually queue:
      // a microtask here would drain every WS event before the next can arrive.
      setTimeout(() => {
        if (generation === this.generation) this.drain();
      }, 0);
    }
  }
  private drain() {
    const start = performance.now();
    let count = 0;
    while (count++ < 64 && performance.now() - start < 4) {
      const priority =
        this.queues.critical.length && (this.streak < 8 || !this.queues.bulk.length)
          ? "critical"
          : "bulk";
      const item = this.queues[priority].shift();
      if (!item) break;
      this.streak = priority === "critical" ? this.streak + 1 : 0;
      if (priority === "critical") {
        const latency = performance.now() - item.at;
        if (latency > this.metrics.worstCriticalLatencyMs) {
          this.metrics.worstCriticalLatencyMs = latency;
          this.report(latency);
        }
      }
      this.dispatch(item.message);
    }
    if (this.queues.critical.length || this.queues.bulk.length) {
      const generation = this.generation;
      setTimeout(() => {
        if (generation === this.generation) this.drain();
      }, 0);
    } else this.pending = false;
  }
  clear() {
    this.generation++;
    this.queues = { critical: [], bulk: [] };
    this.pending = false;
    this.streak = 0;
  }
}
