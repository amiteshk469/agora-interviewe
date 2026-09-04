export const FOCUS_GUARD_FLAG_THRESHOLD = 3;
export const FOCUS_GUARD_EVENT_COOLDOWN_MS = 1_500;

export type BrowserFocusEvent = "tab_hidden" | "window_blur" | "fullscreen_exit" | "camera_disabled";

const eventLabels: Record<BrowserFocusEvent, string> = {
  tab_hidden: "Interview tab was hidden",
  window_blur: "Interview window lost focus",
  fullscreen_exit: "Candidate exited fullscreen",
  camera_disabled: "Candidate camera was turned off",
};

export function focusGuardEventLabel(event: BrowserFocusEvent) {
  return eventLabels[event];
}

/** Prevent one browser action from creating a burst of duplicate integrity events. */
export class FocusGuardEventGate {
  private lastFocusSignalAt: number | null = null;
  private lastCameraSignalAt: number | null = null;

  accept(event: BrowserFocusEvent, now: number) {
    const isCameraSignal = event === "camera_disabled";
    const previous = isCameraSignal ? this.lastCameraSignalAt : this.lastFocusSignalAt;
    if (previous !== null && now - previous < FOCUS_GUARD_EVENT_COOLDOWN_MS) return false;
    if (isCameraSignal) this.lastCameraSignalAt = now;
    else this.lastFocusSignalAt = now;
    return true;
  }
}
