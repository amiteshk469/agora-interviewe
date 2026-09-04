"use client";

import type { IRemoteVideoTrack } from "agora-rtc-react";
import type { RTMClient } from "agora-rtm";
import dynamic from "next/dynamic";
import { AlertCircle, AudioLines, Radio, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { demoModeEnabled, getAgoraConfig, startAgoraAgent, stopAgoraAgent, type AgoraConfig, type StoredLiveSession } from "@/lib/api";

export type LiveTranscriptTurn = { id: string; uid: string; isLocal: boolean; text: string; status: string; final: boolean; interrupted: boolean };
export type LiveAgentState = "idle" | "listening" | "thinking" | "speaking" | "silent" | null;
export type LiveMediaState = {
  microphoneEnabled: boolean;
  candidateSpeaking: boolean;
  hostSpeaking: boolean;
  remoteVideos: Array<{ uid: string; track: IRemoteVideoTrack }>;
  connectionState: string;
};
type RtmStatusEvent = { newState?: string; state?: string } | Record<string, unknown>;
type RtmStatusListener = (event: RtmStatusEvent) => void;

const AgoraVoiceClient = dynamic(() => import("@/components/agora-voice-client"), {
  ssr: false,
  loading: () => (
    <div className="h-12 w-56 animate-pulse rounded-md bg-muted motion-reduce:animate-none" role="status" aria-live="polite" aria-label="Loading Agora voice controls">
      <span className="sr-only">Loading Agora voice controls…</span>
    </div>
  ),
});

function waitForRtmConnected(client: RTMClient, timeoutMs = 800) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const statusClient = client as unknown as {
      addEventListener: (event: "status", listener: RtmStatusListener) => void;
      removeEventListener: (event: "status", listener: RtmStatusListener) => void;
    };
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      statusClient.removeEventListener("status", onStatus);
      resolve();
    }
    const onStatus: RtmStatusListener = (event) => {
      if (("newState" in event ? event.newState : "state" in event ? event.state : undefined) === "CONNECTED") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    statusClient.addEventListener("status", onStatus);
  });
}

export function AgoraLivePanel({ prepared, renewConnection, onTranscript, onAgentState, onMediaState }: { prepared?: StoredLiveSession | null; renewConnection?: () => Promise<AgoraConfig>; onTranscript?: (turns: LiveTranscriptTurn[]) => void; onAgentState?: (state: LiveAgentState) => void; onMediaState?: (state: LiveMediaState) => void }) {
  const [config, setConfig] = useState<AgoraConfig | null>(null);
  const [rtm, setRtm] = useState<RTMClient | null>(null);
  const [phase, setPhase] = useState<"demo" | "connecting" | "live" | "error">("demo");
  const [error, setError] = useState("");
  const preparedStarted = useRef(false);
  const mounted = useRef(true);
  const rtmRef = useRef<RTMClient | null>(null);
  const demoAgentId = useRef("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const activeRtm = rtmRef.current;
      rtmRef.current = null;
      if (activeRtm) {
        void activeRtm.unsubscribe(prepared?.connection?.channel_name ?? "")
          .catch(() => undefined)
          .then(() => activeRtm.logout().catch(() => undefined));
      }
      if (demoAgentId.current) void stopAgoraAgent(demoAgentId.current).catch(() => undefined);
    };
  }, [prepared?.connection?.channel_name]);

  const connectPrepared = useCallback(async () => {
    if (!prepared?.connection) return;
    setPhase("connecting");
    setError("");
    let nextRtm: RTMClient | null = null;
    try {
      const { default: AgoraRTM } = await import("agora-rtm");
      nextRtm = new AgoraRTM.RTM(prepared.connection.app_id, prepared.connection.uid);
      await nextRtm.login({ token: prepared.connection.token });
      await waitForRtmConnected(nextRtm);
      await nextRtm.subscribe(prepared.connection.channel_name);
      if (!mounted.current) {
        await nextRtm.logout().catch(() => undefined);
        return;
      }
      rtmRef.current = nextRtm;
      setRtm(nextRtm);
      setConfig(prepared.connection);
      setPhase("live");
    } catch (cause) {
      await nextRtm?.logout().catch(() => undefined);
      if (!mounted.current) return;
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Configured Agora session could not connect");
    }
  }, [prepared]);

  useEffect(() => {
    if (!prepared?.connection || preparedStarted.current) return;
    preparedStarted.current = true;
    void connectPrepared();
  }, [connectPrepared, prepared?.connection]);

  const connect = useCallback(async () => {
    if (!demoModeEnabled) {
      setPhase("error");
      setError("Create and start a configured interview before joining audio");
      return;
    }
    setPhase("connecting");
    setError("");
    let nextRtm: RTMClient | null = null;
    let nextAgentId = "";
    try {
      const nextConfig = await getAgoraConfig();
      const [{ default: AgoraRTM }, startedAgentId] = await Promise.all([
        import("agora-rtm"),
        startAgoraAgent(nextConfig),
      ]);
      nextAgentId = startedAgentId;
      nextRtm = new AgoraRTM.RTM(nextConfig.app_id, nextConfig.uid);
      await nextRtm.login({ token: nextConfig.token });
      await waitForRtmConnected(nextRtm);
      await nextRtm.subscribe(nextConfig.channel_name);
      if (!mounted.current) {
        await Promise.allSettled([nextRtm.logout(), stopAgoraAgent(nextAgentId)]);
        return;
      }
      rtmRef.current = nextRtm;
      demoAgentId.current = nextAgentId;
      setRtm(nextRtm);
      setConfig(nextConfig);
      setPhase("live");
    } catch (cause) {
      await Promise.allSettled([
        ...(nextRtm ? [nextRtm.logout()] : []),
        ...(nextAgentId ? [stopAgoraAgent(nextAgentId)] : []),
      ]);
      if (!mounted.current) return;
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Agora could not connect");
    }
  }, []);

  if (phase === "live" && config && rtm) {
    return <AgoraVoiceClient config={config} sessionId={renewConnection ? undefined : prepared?.demo ? undefined : prepared?.sessionId} renewConnection={renewConnection} rtmClient={rtm} onTranscript={onTranscript} onAgentState={onAgentState} onMediaState={onMediaState} />;
  }

  const status = phase === "connecting"
    ? "Connecting to Agora…"
    : prepared?.connection
      ? "Configured audio ready"
      : demoModeEnabled
        ? "Interactive demo"
        : "Waiting for session";
  const buttonLabel = phase === "connecting"
    ? "Connecting…"
    : phase === "error"
      ? "Retry Agora"
      : prepared?.connection
        ? "Join Configured Audio"
        : demoModeEnabled
          ? "Connect Live Audio"
          : "Session Required";

  return (
    <div className="space-y-3" aria-busy={phase === "connecting"}>
      {phase === "error" ? (
        <Alert title="Live Connection Unavailable" variant="destructive">
          <span className="break-words">{error}. {demoModeEnabled ? "Keep exploring the demo or retry when the backend is configured." : "Return to the lobby and start the configured session again."}</span>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge variant={phase === "connecting" ? "default" : "secondary"} role="status" aria-live="polite" aria-atomic="true">{phase === "connecting" ? <Radio className="size-3 animate-pulse motion-reduce:animate-none" aria-hidden="true" /> : <AudioLines className="size-3" aria-hidden="true" />}{status}</Badge>
        <Button size="sm" variant="secondary" className="rounded-full" onClick={prepared?.connection ? connectPrepared : connect} loading={phase === "connecting"} disabled={!prepared?.connection && !demoModeEnabled}>{phase === "error" ? <RotateCcw aria-hidden="true" /> : <Radio aria-hidden="true" />}{buttonLabel}</Button>
        {phase === "error" && demoModeEnabled ? <Button size="sm" variant="ghost" onClick={() => setPhase("demo")}><AlertCircle aria-hidden="true" />Use Demo</Button> : null}
      </div>
    </div>
  );
}
