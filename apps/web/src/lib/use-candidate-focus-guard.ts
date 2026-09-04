"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FocusGuardEventGate,
  focusGuardEventLabel,
  type BrowserFocusEvent,
} from "@/lib/focus-guard";

type Options = {
  enabled: boolean;
  onEvent: (event: BrowserFocusEvent, detail: string) => void | Promise<unknown>;
};

export function useCandidateFocusGuard({ enabled, onEvent }: Options) {
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [attentionRequired, setAttentionRequired] = useState(false);
  const [lastEvent, setLastEvent] = useState<BrowserFocusEvent | null>(null);
  const gate = useRef(new FocusGuardEventGate());
  const everFullscreen = useRef(false);
  const enabledRef = useRef(enabled);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    enabledRef.current = enabled;
    onEventRef.current = onEvent;
  }, [enabled, onEvent]);

  const report = useCallback((event: BrowserFocusEvent, detail: string) => {
    if (!enabledRef.current || !gate.current.accept(event, performance.now())) return;
    setLastEvent(event);
    setAttentionRequired(true);
    void Promise.resolve(onEventRef.current(event, detail));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let blurTimer: number | null = null;
    const clearBlurTimer = () => {
      if (blurTimer === null) return;
      window.clearTimeout(blurTimer);
      blurTimer = null;
    };
    const onVisibilityChange = () => {
      if (!document.hidden) return;
      clearBlurTimer();
      report("tab_hidden", "The interview page became hidden or the browser was minimized.");
    };
    const onBlur = () => {
      clearBlurTimer();
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (!document.hidden && !document.hasFocus()) {
          report("window_blur", "The interview browser window lost operating-system focus.");
        }
      }, 350);
    };
    const onFocus = clearBlurTimer;
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreenActive(active);
      if (active) {
        everFullscreen.current = true;
        setAttentionRequired(false);
      } else if (everFullscreen.current) {
        report("fullscreen_exit", "Fullscreen focus mode was exited during the interview.");
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      clearBlurTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, report]);

  const enterFocusMode = useCallback(async () => {
    if (!document.fullscreenEnabled) {
      setAttentionRequired(false);
      return false;
    }
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      everFullscreen.current = true;
      setFullscreenActive(true);
      setAttentionRequired(false);
      return true;
    } catch {
      setAttentionRequired(true);
      return false;
    }
  }, []);

  const acknowledge = useCallback(() => setAttentionRequired(false), []);

  return {
    fullscreenActive,
    fullscreenSupported: typeof document !== "undefined" && document.fullscreenEnabled,
    attentionRequired,
    lastEvent,
    lastEventLabel: lastEvent ? focusGuardEventLabel(lastEvent) : "",
    enterFocusMode,
    acknowledge,
    report,
  };
}
