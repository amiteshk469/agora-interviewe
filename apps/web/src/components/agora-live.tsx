"use client";

import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-react";
import type { RTMClient } from "agora-rtm";
import dynamic from "next/dynamic";
import { AlertCircle, AudioLines, Radio, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { demoModeEnabled, getAgoraConfig, startAgoraAgent, stopAgoraAgent, type AgoraConfig, type StoredLiveSession } from "@/lib/api";

export type LiveTranscriptTurn = { id: string; uid: string; isLocal: boolean; text: string; status: string; final: boolean; interrupted: boolean };
export type LiveAgentState = "idle" | "listening" | "thinking" | "speaking" | "silent" | null;
export type LiveMediaState = {
  localCameraTrack: ICameraVideoTrack | null;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  remoteVideos: Array<{ uid: string; track: IRemoteVideoTrack }>;
  connectionState: string;
};
type RtmStatusEvent = { newState?: string; state?: string } | Record<string, unknown>;
type RtmStatusListener = (event: RtmStatusEvent) => void;

const AgoraVoiceClient = dynamic(() => import("@/components/agora-voice-client"), {
  ssr: false,
  loading: () => <div className="h-12 w-56 animate-pulse rounded-md bg-muted" aria-label="Loading Agora voice controls" />,
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

export function AgoraLivePanel({ prepared, onTranscript, onAgentState, onMediaState }: { prepared?: StoredLiveSession | null; onTranscript?: (turns: LiveTranscriptTurn[]) => void; onAgentState?: (state: LiveAgentState) => void; onMediaState?: (state: LiveMediaState) => void }) {
  const [config, setConfig] = useState<AgoraConfig | null>(null);
  const [rtm, setRtm] = useState<RTMClient | null>(null);
  const [agentId, setAgentId] = useState("");
  const [phase, setPhase] = useState<"demo" | "connecting" | "live" | "error">("demo");
  const [error, setError] = useState("");
  const preparedStarted = useRef(false);

  const connectPrepared = useCallback(async () => {
    if (!prepared?.connection) return;
    setPhase("connecting");
    setError("");
    try {
      const { default: AgoraRTM } = await import("agora-rtm");
      const nextRtm: RTMClient = new AgoraRTM.RTM(prepared.connection.app_id, prepared.connection.uid);
      await nextRtm.login({ token: prepared.connection.token });
      await waitForRtmConnected(nextRtm);
      await nextRtm.subscribe(prepared.connection.channel_name);
      setAgentId(prepared.agentId);
      setRtm(nextRtm);
      setConfig(prepared.connection);
      setPhase("live");
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Configured Agora session could not connect");
    }
  }, [prepared]);

  useEffect(() => {
    if (!prepared?.connection || preparedStarted.current) return;
    preparedStarted.current = true;
    void connectPrepared();
  }, [connectPrepared, prepared?.connection]);

  useEffect(() => () => {
    void rtm?.logout().catch(() => undefined);
    if (agentId && !prepared) void stopAgoraAgent(agentId).catch(() => undefined);
  }, [agentId, prepared, rtm]);

  const connect = useCallback(async () => {
    if (!demoModeEnabled) {
      setPhase("error");
      setError("Create and start a configured interview before joining audio");
      return;
    }
    setPhase("connecting");
    setError("");
    try {
      const nextConfig = await getAgoraConfig();
      const [{ default: AgoraRTM }, nextAgentId] = await Promise.all([
        import("agora-rtm"),
        startAgoraAgent(nextConfig),
      ]);
      const nextRtm: RTMClient = new AgoraRTM.RTM(nextConfig.app_id, nextConfig.uid);
      await nextRtm.login({ token: nextConfig.token });
      await waitForRtmConnected(nextRtm);
      await nextRtm.subscribe(nextConfig.channel_name);
      setAgentId(nextAgentId);
      setRtm(nextRtm);
      setConfig(nextConfig);
      setPhase("live");
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Agora could not connect");
    }
  }, []);

  if (phase === "live" && config && rtm) {
    return <AgoraVoiceClient config={config} sessionId={prepared?.demo ? undefined : prepared?.sessionId} rtmClient={rtm} onTranscript={onTranscript} onAgentState={onAgentState} onMediaState={onMediaState} />;
  }

  return (
    <div className="space-y-3">
      {phase === "error" ? (
        <Alert title="Live connection unavailable" variant="destructive">
          <span>{error}. {demoModeEnabled ? "You can keep exploring the complete demo or retry when the backend is configured." : "Return to the lobby and start the configured session again."}</span>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-xl">
        <Badge variant={phase === "connecting" ? "default" : "secondary"}>{phase === "connecting" ? <Radio className="size-3 animate-pulse" aria-hidden="true" /> : <AudioLines className="size-3" aria-hidden="true" />}{phase === "connecting" ? "Connecting to Agora" : prepared?.connection ? "Configured audio ready" : demoModeEnabled ? "Interactive demo" : "Waiting for session"}</Badge>
        <Button size="sm" variant="secondary" onClick={prepared?.connection ? connectPrepared : connect} loading={phase === "connecting"} disabled={!prepared?.connection && !demoModeEnabled}>{phase === "error" ? <RotateCcw aria-hidden="true" /> : <Radio aria-hidden="true" />}{phase === "error" ? "Retry Agora" : prepared?.connection ? "Join configured audio" : demoModeEnabled ? "Connect live audio" : "Session required"}</Button>
        {phase === "error" && demoModeEnabled ? <Button size="sm" variant="ghost" onClick={() => setPhase("demo")}><AlertCircle aria-hidden="true" />Use demo</Button> : null}
      </div>
    </div>
  );
}
