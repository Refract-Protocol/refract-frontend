# Attention cues (audio + haptics)

Attention is governed centrally, like motion (`usePrefersReducedMotion`,
`prefers-reduced-motion` in `globals.css`). **No component plays sounds or
vibrates directly** — request a cue by severity through `AttentionCueService`
(`src/lib/attentionCue.ts`, wired by `src/hooks/useAttentionCue.ts`).

Policy:

- Only `critical` notifications (oracle trigger, claim settled/denied) cue.
- Off by default; persisted via `preferences.attentionCues`, toggled in the
  Notification Center.
- Suppressed under `prefers-reduced-motion`, `Save-Data`, and quiet hours
  (22:00–07:00 local).
- Audio is synthesized (Web Audio, no asset) and only starts after a user
  gesture unlocks the `AudioContext`; earlier events are dropped, not queued.
- Bursts within 1s coalesce into one cue; the first emission (backfill) never
  cues. `navigator.vibrate` is a silent no-op where unsupported (iOS).
- A cue never replaces the accessible (ARIA live) announcement.
- The `AudioContext` is closed on unmount.
