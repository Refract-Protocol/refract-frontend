const CHANNEL = "refract-realtime";
const HEARTBEAT_MS = 2_000;
const LEADER_TIMEOUT_MS = 6_000;

type TabMessage =
  | { t: "hb"; id: string }
  | { t: "bye"; id: string }
  | { t: "topics"; id: string; topics: string[] }
  | { t: "data"; raw: string };

/**
 * Leader election over BroadcastChannel so only one tab holds the socket.
 * The lowest tab id wins a conflict; a follower promotes itself when the
 * leader's heartbeat stops (closed or crashed tab). Without BroadcastChannel
 * every tab is its own leader (the pre-existing behaviour).
 */
export class TabLeader {
  readonly id = Math.random().toString(36).slice(2);
  isLeader = false;
  private channel: BroadcastChannel | null = null;
  private lastHeartbeat = 0;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private tabTopics = new Map<string, Set<string>>();

  constructor(
    private readonly onRole: (isLeader: boolean) => void,
    private readonly onData: (raw: string) => void,
    private readonly onTopicsChanged: () => void
  ) {}

  start(): void {
    if (typeof BroadcastChannel === "undefined") return this.setLeader(true);
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent<TabMessage>) => this.receive(e.data);
    this.hbTimer = setInterval(() => this.tick(), HEARTBEAT_MS);
    // First tab claims leadership after a short listen window.
    setTimeout(() => this.tick(), 300);
    if (typeof window !== "undefined") window.addEventListener("pagehide", () => this.stop());
  }

  private tick(): void {
    if (this.isLeader) this.post({ t: "hb", id: this.id });
    else if (Date.now() - this.lastHeartbeat > (this.lastHeartbeat === 0 ? 0 : LEADER_TIMEOUT_MS)) this.setLeader(true);
  }

  private receive(msg: TabMessage): void {
    if (msg.t === "hb") {
      this.lastHeartbeat = Date.now();
      if (this.isLeader && msg.id < this.id) this.setLeader(false);
    } else if (msg.t === "bye") {
      this.tabTopics.delete(msg.id);
      if (!this.isLeader) this.lastHeartbeat = 0; // promote promptly if the leader left
      this.onTopicsChanged();
    } else if (msg.t === "topics") {
      this.tabTopics.set(msg.id, new Set(msg.topics));
      this.onTopicsChanged();
    } else if (!this.isLeader) {
      this.onData(msg.raw);
    }
  }

  private setLeader(value: boolean): void {
    if (this.isLeader === value) return;
    this.isLeader = value;
    if (value) this.post({ t: "hb", id: this.id });
    this.onRole(value);
  }

  announceTopics(topics: string[]): void {
    this.post({ t: "topics", id: this.id, topics });
  }

  /** Union of topics other tabs need — combined with this tab's own by the client (ref-counted across tabs). */
  remoteTopics(): Set<string> {
    const all = new Set<string>();
    this.tabTopics.forEach((s) => s.forEach((t) => all.add(t)));
    return all;
  }

  broadcast(raw: string): void {
    if (this.isLeader) this.post({ t: "data", raw });
  }

  private post(msg: TabMessage): void {
    this.channel?.postMessage(msg);
  }

  stop(): void {
    this.post({ t: "bye", id: this.id });
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.channel?.close();
    this.channel = null;
    this.isLeader = false;
  }
}
