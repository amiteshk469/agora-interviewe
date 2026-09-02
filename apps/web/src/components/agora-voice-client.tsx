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
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteAudioTracks,
  useRemoteUsers,
  useRemoteVideoTracks,
  useRTCClient,
} from "agora-rtc-react";
import type { RTMClient } from "agora-rtm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Waves } from "lucide-react";
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
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const detail = error as Record<string, unknown>;
    const message = [detail.message, detail.reason, detail.description].find(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    const code = [detail.code, detail.type].find(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    );
    if (message && code !== undefined) return `${message.trim()} (${String(code)})`;
    if (message) return message.trim();
    if (code !== undefined) return `${fallback} (${String(code)})`;
  }
  return fallback;
}

type RoomToneGraph = {
  context: AudioContext;
  source: AudioBufferSourceNode;
};

function createRoomTone(): RoomToneGraph {
  const context = new AudioContext();
  const seconds = 20;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let brown = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    samples[index] = brown * 3.5;
  }

  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  highpass.type = "highpass";
  highpass.frequency.value = 70;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 900;
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.018, context.currentTime + 0.8);
  source.connect(highpass).connect(lowpass).connect(gain).connect(context.destination);
  source.start();
  return { context, source };
}

function disposeRoomTone(graph: RoomToneGraph | null) {
  if (!graph) return;
  try {
    graph.source.stop();
  } catch {}
  void graph.context.close();
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
  const [connectionState, setConnectionState] = useState("CONNECTING");
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [roomToneEnabled, setRoomToneEnabled] = useState(false);
  const roomToneRef = useRef<RoomToneGraph | null>(null);

  const { isConnected, error: joinError } = useJoin({ appid: config.app_id, channel: config.channel_name, token: config.token, uid: Number(config.uid) }, true);
  const { localMicrophoneTrack, error: microphoneError } = useLocalMicrophoneTrack(true, { AEC: true, ANS: true, AGC: true });
  const { videoTracks, error: remoteVideoError } = useRemoteVideoTracks(remoteUsers);
  const { audioTracks, error: remoteAudioError } = useRemoteAudioTracks(remoteUsers);
  const { error: publishError } = usePublish([localMicrophoneTrack]);

  useEffect(() => {
    onMediaState?.({
      microphoneEnabled: enabled,
      remoteVideos: videoTracks.map((track) => ({ uid: String(track.getUserId()), track })),
      connectionState,
    });
  }, [connectionState, enabled, onMediaState, videoTracks]);

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

  useEffect(() => () => {
    disposeRoomTone(roomToneRef.current);
    roomToneRef.current = null;
  }, []);

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

  const sdkError = joinError || microphoneError || publishError || remoteAudioError || remoteVideoError;
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

  const toggleRoomTone = useCallback(async () => {
    if (roomToneRef.current) {
      disposeRoomTone(roomToneRef.current);
      roomToneRef.current = null;
      setRoomToneEnabled(false);
      return;
    }
    let graph: RoomToneGraph | null = null;
    try {
      graph = createRoomTone();
      await graph.context.resume();
      roomToneRef.current = graph;
      setRoomToneEnabled(true);
    } catch (error) {
      disposeRoomTone(graph);
      console.warn("Local room tone could not start", error);
      setRoomToneEnabled(false);
    }
  }, []);

  return (
    <div className="space-y-2">
      {displayedError ? <Alert title="Live Media Needs Attention" variant="destructive"><span className="break-words">{displayedError}</span></Alert> : null}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2" role="group" aria-label="Agora live media controls" aria-busy={!isConnected && connectionState !== "DISCONNECTED"}>
        <div className="size-10 overflow-hidden rounded-md border bg-background" aria-hidden="true"><AgentVisualizer state={visualizerState} size="sm" /></div>
        <Badge variant={displayedError ? "destructive" : isConnected ? "default" : "secondary"} role="status" aria-live="polite" aria-atomic="true"><Radio className="size-3" aria-hidden="true" />{connectionStatus}</Badge>
        <div className="conversation-mic-host flex items-center justify-center">
          <MicButtonWithVisualizer isEnabled={enabled} setIsEnabled={setEnabled} track={localMicrophoneTrack} onToggle={toggleMic} aria-label={enabled ? "Mute microphone" : "Unmute microphone"} enabledColor="oklch(0.675 0.175 245)" disabledColor="oklch(0.63 0.205 25)" />
        </div>
        <Button size="sm" variant={roomToneEnabled ? "secondary" : "outline"} onClick={toggleRoomTone} aria-pressed={roomToneEnabled} title="Play subtle room ambience locally; it is never published to Agora">
          <Waves aria-hidden="true" /><span className="hidden sm:inline">Room tone</span>
        </Button>
        {audioTracks.map((track) => <RemoteAudioTrack key={String(track.getUserId())} track={track} play />)}
      </div>
    </div>
  );
}
