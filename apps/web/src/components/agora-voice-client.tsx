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
import { Badge, Button } from "@/components/ui";
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

  const { isConnected } = useJoin({ appid: config.app_id, channel: config.channel_name, token: config.token, uid: Number(config.uid) }, true);
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(true, { AEC: true, ANS: true, AGC: true });
  const { localCameraTrack } = useLocalCameraTrack(true);
  const { videoTracks } = useRemoteVideoTracks(remoteUsers);
  const { audioTracks } = useRemoteAudioTracks(remoteUsers);
  usePublish([localMicrophoneTrack, localCameraTrack]);

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
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUid, error) => console.error("[AgoraVoiceAI] message error", agentUid, error));
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUid, error) => console.error("[AgoraVoiceAI] agent error", agentUid, error));
        ai.subscribeMessage(config.channel_name);
      } catch (error) {
        console.error("[AgoraVoiceAI] init failed", error);
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
  });

  const visualizerState = useMemo<AgentVisualizerState>(() => {
    if (!isConnected) return connectionState === "CONNECTING" || connectionState === "RECONNECTING" ? "joining" : "not-joined";
    if (agentState === "listening") return "listening";
    if (agentState === "thinking") return "analyzing";
    if (agentState === "speaking") return "talking";
    return "ambient";
  }, [agentState, connectionState, isConnected]);

  const toggleMic = useCallback(async () => {
    const next = !enabled;
    if (localMicrophoneTrack) await localMicrophoneTrack.setEnabled(next);
    setEnabled(next);
  }, [enabled, localMicrophoneTrack]);

  const toggleCamera = useCallback(async () => {
    const next = !cameraEnabled;
    if (localCameraTrack) await localCameraTrack.setEnabled(next);
    setCameraEnabled(next);
  }, [cameraEnabled, localCameraTrack]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-[var(--panel-shadow)]" aria-label="Agora live media controls">
      <div className="size-10 overflow-hidden rounded-md border bg-background"><AgentVisualizer state={visualizerState} size="sm" /></div>
      <Badge variant="default"><Radio className="size-3" aria-hidden="true" />{isConnected ? `Live: ${agentState ?? "joining"}` : "Joining Agora"}</Badge>
      <div className="conversation-mic-host flex items-center justify-center">
        <MicButtonWithVisualizer isEnabled={enabled} setIsEnabled={setEnabled} track={localMicrophoneTrack} onToggle={toggleMic} aria-label={enabled ? "Mute microphone" : "Unmute microphone"} enabledColor="oklch(0.675 0.175 245)" disabledColor="oklch(0.63 0.205 25)" />
      </div>
      <Button size="icon" variant={cameraEnabled ? "outline" : "secondary"} onClick={toggleCamera} aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}>
        {cameraEnabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}
      </Button>
      {audioTracks.map((track) => <RemoteAudioTrack key={String(track.getUserId())} track={track} play />)}
    </div>
  );
}
