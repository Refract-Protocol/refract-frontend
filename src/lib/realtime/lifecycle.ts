import type { RealtimeClient } from "./client";

/** Bind browser lifecycle events to the client without making the client DOM-dependent. */
export function bindRealtimeLifecycle(
  client: Pick<RealtimeClient, "suspend" | "resume">,
  target: Window = window
): () => void {
  let frozen = false;
  const suspend = () => {
    if (!frozen) {
      frozen = true;
      client.suspend();
    }
  };
  const resume = () => {
    if (frozen) {
      frozen = false;
      client.resume();
    }
  };
  const onPageHide = () => suspend();
  const onPageShow = () => resume();
  const onFreeze = () => suspend();
  const onResume = () => resume();
  const onVisibilityChange = () => {
    if (target.document.visibilityState === "hidden") suspend();
    else resume();
  };
  target.addEventListener("pagehide", onPageHide);
  target.addEventListener("pageshow", onPageShow);
  target.addEventListener("freeze", onFreeze);
  target.addEventListener("resume", onResume);
  target.document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    target.removeEventListener("pagehide", onPageHide);
    target.removeEventListener("pageshow", onPageShow);
    target.removeEventListener("freeze", onFreeze);
    target.removeEventListener("resume", onResume);
    target.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
