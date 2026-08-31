"use client";

import {
  type AgentState,
  type AgentTranscription,
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  type TranscriptHelperItem,
  TranscriptHelperMode,
  TurnStatus,
  type UserTranscription,
} from "agora-agent-client-toolkit";
import { AgentVisualizer, type AgentVisualizerState } from "agora-agent-uikit";
import { MicButtonWithVisualizer } from "agora-agent-uikit/rtc";
import {
  AgoraRTCProvider,
  default as AgoraRTC,
  RemoteAudioTrack,
  useClientEvent,
  useJoin,
  useLocalCameraTrack,
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteAudioTracks,
  useRemoteUsers,
  useRemoteVideoTracks,
  useRTCClient,
} from "agora-rtc-react";
import type { RTMClient } from "agora-rtm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Radio } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import type { LiveAgentState, LiveMediaState, LiveTranscriptTurn } from "@/components/agora-live";
import { getAgoraConfig, renewInterviewSessionToken, type AgoraConfig } from "@/lib/api";

type Props = {
  config: AgoraConfig;
  sessionId?: string;
  rtmClient: RTMClient;
  onTranscript?: (turns: LiveTranscriptTurn[]) => void;
  onAgentState?: (state: LiveAgentState) => void;
  onMediaState?: (state: LiveMediaState) => void;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AgoraVoiceClient(props: Props) {
  const clientRef = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(null);
  if (clientRef.current === null) clientRef.current = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  // Official Agora quickstart pattern keeps one RTC client through Strict Mode renders.
  // eslint-disable-next-line react-hooks/refs
  const client = clientRef.current;
  return <AgoraRTCProvider client={client}><VoiceChannel {...props} /></AgoraRTCProvider>;
}

function VoiceChannel({ config, sessionId, rtmClient, onTranscript, onAgentState, onMediaState }: Props) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [enabled, setEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState("CONNECTING");
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [voiceError, setVoiceError] = useState("");

  const { isConnected, error: joinError } = useJoin({ appid: config.app_id, channel: config.channel_name, token: config.token, uid: Number(config.uid) }, true);
  const { localMicrophoneTrack, error: microphoneError } = useLocalMicrophoneTrack(true, { AEC: true, ANS: true, AGC: true });
  const { localCameraTrack, error: cameraError } = useLocalCameraTrack(true);
  const { videoTracks, error: remoteVideoError } = useRemoteVideoTracks(remoteUsers);
  const { audioTracks, error: remoteAudioError } = useRemoteAudioTracks(remoteUsers);
  const { error: publishError } = usePublish([localMicrophoneTrack, localCameraTrack]);

  useEffect(() => {
    onMediaState?.({
      localCameraTrack,
      cameraEnabled,
      microphoneEnabled: enabled,
      remoteVideos: videoTracks.map((track) => ({ uid: String(track.getUserId()), track })),
      connectionState,
    });
  }, [cameraEnabled, connectionState, enabled, localCameraTrack, onMediaState, videoTracks]);

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    void (async () => {
      try {
        const ai = await AgoraVoiceAI.init({ rtcEngine: client, rtmConfig: { rtmEngine: rtmClient }, renderMode: TranscriptHelperMode.TEXT, enableLog: true });
        if (cancelled) {
          ai.unsubscribe();
          ai.destroy();
          return;
        }
        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
          const next = (items as TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]).map((item) => ({
            id: String(item.turn_id),
            uid: String(item.uid) === "0" ? String(client.uid ?? config.uid) : String(item.uid),
            isLocal: String(item.uid) === "0" || String(item.uid) === String(client.uid ?? config.uid),
            text: typeof item.text === "string" ? item.text.replace(/([.!?])([A-Za-z])/g, "$1 $2").trim() : "",
            status: String(item.status),
            final: item.status !== TurnStatus.IN_PROGRESS,
            interrupted: item.status === TurnStatus.INTERRUPTED,
          }));
          onTranscript?.(next);
        });
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) => {
          setAgentState(event.state);
          onAgentState?.(event.state);
        });
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_, metrics) => console.debug("[AgoraVoiceAI] metrics", metrics));
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUid, error) => {
          console.error("[AgoraVoiceAI] message error", agentUid, error);
          setVoiceError(`${errorMessage(error, "Agora could not process a live message")}. Rejoin from the lobby if it continues.`);
        });
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUid, error) => {
          console.error("[AgoraVoiceAI] agent error", agentUid, error);
          setVoiceError(`${errorMessage(error, "The interviewer agent encountered an error")}. Rejoin from the lobby to recover.`);
        });
        ai.subscribeMessage(config.channel_name);
      } catch (error) {
        console.error("[AgoraVoiceAI] init failed", error);
        if (!cancelled) setVoiceError(`${errorMessage(error, "Agora voice initialization failed")}. Return to the lobby, then retry the session.`);
      }
    })();
    return () => {
      cancelled = true;
      try {
        const ai = AgoraVoiceAI.getInstance();
        ai?.unsubscribe();
        ai?.destroy();
      } catch {}
    };
  }, [client, config.channel_name, config.uid, isConnected, onAgentState, onTranscript, rtmClient]);

  useClientEvent(client, "connection-state-change", (current) => setConnectionState(current));
  useClientEvent(client, "token-privilege-will-expire", async () => {
    try {
      if (sessionId) {
        const next = await renewInterviewSessionToken(sessionId);
        await client.renewToken(next.token);
        await rtmClient.renewToken(next.token);
        return;
      }
      const [rtcConfig, rtmConfig] = await Promise.all([
        getAgoraConfig({ channel: config.channel_name, uid: String(client.uid ?? config.uid) }),
        getAgoraConfig({ channel: config.channel_name, uid: config.uid }),
      ]);
      await client.renewToken(rtcConfig.token);
      await rtmClient.renewToken(rtmConfig.token);
    } catch (error) {
      console.error("[AgoraVoiceAI] token renewal failed", error);
      setVoiceError(`${errorMessage(error, "Agora credentials could not be renewed")}. Rejoin from the lobby before the connection expires.`);
    }
  });

  const visualizerState = useMemo<AgentVisualizerState>(() => {
    if (!isConnected) return connectionState === "CONNECTING" || connectionState === "RECONNECTING" ? "joining" : "not-joined";
    if (agentState === "listening") return "listening";
    if (agentState === "thinking") return "analyzing";
    if (agentState === "speaking") return "talking";
    return "ambient";
  }, [agentState, connectionState, isConnected]);

  const sdkError = joinError || microphoneError || cameraError || publishError || remoteAudioError || remoteVideoError;
  const displayedError = voiceError || (sdkError
    ? `${errorMessage(sdkError, "Agora media initialization failed")}. Check browser media permissions, then rejoin from the lobby.`
    : "");
  const connectionStatus = displayedError
    ? "Agora voice needs attention"
    : connectionState === "RECONNECTING"
      ? "Reconnecting to Agora…"
      : isConnected
        ? `Live: ${agentState || "joining"}`
        : connectionState === "DISCONNECTED"
          ? "Agora disconnected"
          : "Joining Agora…";

  const toggleMic = useCallback(async () => {
    const next = !enabled;
    try {
      if (localMicrophoneTrack) await localMicrophoneTrack.setEnabled(next);
      setEnabled(next);
    } catch (error) {
      setVoiceError(`${errorMessage(error, "The microphone could not be updated")}. Check browser permissions and retry.`);
    }
  }, [enabled, localMicrophoneTrack]);

  const toggleCamera = useCallback(async () => {
    const next = !cameraEnabled;
    try {
      if (localCameraTrack) await localCameraTrack.setEnabled(next);
      setCameraEnabled(next);
    } catch (error) {
      setVoiceError(`${errorMessage(error, "The camera could not be updated")}. Check browser permissions and retry.`);
    }
  }, [cameraEnabled, localCameraTrack]);

  return (
    <div className="space-y-2">
      {displayedError ? <Alert title="Live Media Needs Attention" variant="destructive"><span className="break-words">{displayedError}</span></Alert> : null}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-[var(--panel-shadow)]" role="group" aria-label="Agora live media controls" aria-busy={!isConnected && connectionState !== "DISCONNECTED"}>
        <div className="size-10 overflow-hidden rounded-md border bg-background" aria-hidden="true"><AgentVisualizer state={visualizerState} size="sm" /></div>
        <Badge variant={displayedError ? "destructive" : isConnected ? "default" : "secondary"} role="status" aria-live="polite" aria-atomic="true"><Radio className="size-3" aria-hidden="true" />{connectionStatus}</Badge>
        <div className="conversation-mic-host flex items-center justify-center">
          <MicButtonWithVisualizer isEnabled={enabled} setIsEnabled={setEnabled} track={localMicrophoneTrack} onToggle={toggleMic} aria-label={enabled ? "Mute microphone" : "Unmute microphone"} enabledColor="oklch(0.675 0.175 245)" disabledColor="oklch(0.63 0.205 25)" />
        </div>
        <Button size="icon" variant={cameraEnabled ? "outline" : "secondary"} onClick={toggleCamera} aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}>
          {cameraEnabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}
        </Button>
        {audioTracks.map((track) => <RemoteAudioTrack key={String(track.getUserId())} track={track} play />)}
      </div>
    </div>
  );
}
