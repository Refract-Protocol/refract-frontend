/** Public entry point of the realtime module — import from "@/lib/realtime", never from internals. */
export { realtimeClient } from "./client";
export {
  initRealtimeFlags,
  loadRealtimeFlags,
  isTopicEnabled,
  setTopicOverride,
  killTopic,
  reviveTopic,
  onTopicFlagChange,
} from "./flags";
