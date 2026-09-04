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
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Waves } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { LiveAgentState, LiveMediaState, LiveTranscriptTurn } from "@/components/agora-live";
import { getAgoraConfig, renewInterviewSessionToken, type AgoraConfig } from "@/lib/api";
import { VoiceActivityDetector } from "@/lib/voice-activity";
import { renewAgoraSeatTokens } from "@/lib/agora-seat";

type Props = {
  config: AgoraConfig;
  sessionId?: string;
  renewConnection?: () => Promise<AgoraConfig>;
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
  sources: AudioScheduledSourceNode[];
};

function createRoomTone(): RoomToneGraph {
  const context = new AudioContext();
  const seconds = 20;
  const baseBuffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const baseSamples = baseBuffer.getChannelData(0);
  let brown = 0;
  for (let index = 0; index < baseSamples.length; index += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    baseSamples[index] = brown * 3.8;
  }

  const airBuffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const airSamples = airBuffer.getChannelData(0);
  for (let index = 0; index < airSamples.length; index += 1) {
    airSamples[index] = (Math.random() * 2 - 1) * 0.16;
  }

  const baseSource = context.createBufferSource();
  const airSource = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const airBand = context.createBiquadFilter();
  const airGain = context.createGain();
  const masterGain = context.createGain();
  const drift = context.createOscillator();
  const driftDepth = context.createGain();

  baseSource.buffer = baseBuffer;
  baseSource.loop = true;
  airSource.buffer = airBuffer;
  airSource.loop = true;
  highpass.type = "highpass";
  highpass.frequency.value = 70;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 1_250;
  airBand.type = "bandpass";
  airBand.frequency.value = 1_800;
  airBand.Q.value = 0.55;
  airGain.gain.value = 0.18;
  drift.frequency.value = 0.07;
  driftDepth.gain.value = 0.045;
  masterGain.gain.setValueAtTime(0, context.currentTime);
  // The previous 0.018 gain vanished beneath laptop fan noise. This is still
  // background-level, but deliberately audible when the user switches it on.
  masterGain.gain.linearRampToValueAtTime(0.052, context.currentTime + 0.9);

  baseSource.connect(highpass).connect(lowpass).connect(masterGain);
  airSource.connect(airBand).connect(airGain).connect(masterGain);
  drift.connect(driftDepth).connect(airGain.gain);
  masterGain.connect(context.destination);
  baseSource.start();
  airSource.start();
  drift.start();
  return { context, sources: [baseSource, airSource, drift] };
}

function disposeRoomTone(graph: RoomToneGraph | null) {
  if (!graph) return;
  for (const source of graph.sources) {
    try {
      source.stop();
    } catch {}
  }
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

function VoiceChannel({ config, sessionId, renewConnection, rtmClient, onTranscript, onAgentState, onMediaState }: Props) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [enabled, setEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState("CONNECTING");
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [roomToneEnabled, setRoomToneEnabled] = useState(false);
  const roomToneRef = useRef<RoomToneGraph | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [candidateSpeaking, setCandidateSpeaking] = useState(false);
  const [hostSpeaking, setHostSpeaking] = useState(false);

  const { isConnected, error: joinError } = useJoin({ appid: config.app_id, channel: config.channel_name, token: config.token, uid: Number(config.uid) }, true);
  const { localMicrophoneTrack, error: microphoneError } = useLocalMicrophoneTrack(true, { AEC: true, ANS: true, AGC: true });
  const { videoTracks, error: remoteVideoError } = useRemoteVideoTracks(remoteUsers);
  const { audioTracks, error: remoteAudioError } = useRemoteAudioTracks(remoteUsers);
  const { error: publishError } = usePublish([localMicrophoneTrack]);

  useEffect(() => {
    onMediaState?.({
      microphoneEnabled: enabled,
      candidateSpeaking: enabled && candidateSpeaking,
      hostSpeaking,
      remoteVideos: videoTracks.map((track) => ({ uid: String(track.getUserId()), track })),
      connectionState,
    });
  }, [candidateSpeaking, connectionState, enabled, hostSpeaking, onMediaState, videoTracks]);

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

  useEffect(() => {
    const detector = new VoiceActivityDetector();
    const timer = window.setInterval(() => {
      const level = localMicrophoneTrack && enabled ? localMicrophoneTrack.getVolumeLevel() : 0;
      const activity = detector.sample(level, performance.now());
      setMicLevel(activity.visualLevel);
      setCandidateSpeaking(activity.speaking);
    }, 120);
    return () => window.clearInterval(timer);
  }, [enabled, localMicrophoneTrack]);

  useEffect(() => {
    const panelUids = new Set([
      String(config.agent_uid),
      ...(config.panelists ?? []).flatMap((participant) => [
        String(participant.agent_uid),
        ...(participant.avatar_uid ? [String(participant.avatar_uid)] : []),
      ]),
    ]);
    const detector = new VoiceActivityDetector();
    const timer = window.setInterval(() => {
      const level = Math.max(
        0,
        ...audioTracks
          .filter((track) => !panelUids.has(String(track.getUserId())))
          .map((track) => track.getVolumeLevel()),
      );
      setHostSpeaking(detector.sample(level, performance.now()).speaking);
    }, 120);
    return () => window.clearInterval(timer);
  }, [audioTracks, config.agent_uid, config.panelists]);

  useClientEvent(client, "connection-state-change", (current) => setConnectionState(current));
  useClientEvent(client, "token-privilege-will-expire", async () => {
    try {
      if (renewConnection) {
        await renewAgoraSeatTokens(renewConnection, client, rtmClient);
        return;
      }
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
      {displayedError ? <Alert title="Live audio needs attention" variant="destructive"><span className="break-words [overflow-wrap:anywhere]">{displayedError}</span></Alert> : null}
      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Live audio controls" aria-busy={!isConnected && connectionState !== "DISCONNECTED"}>
        {/* Muting is the control people reach for under pressure, so it reads as the
            primary one: filled when live, destructive when muted, and ringed by the
            candidate's own speech level so they can see the room is hearing them. */}
        <button
          type="button"
          onClick={toggleMic}
          aria-pressed={!enabled}
          aria-label={enabled ? "Mute microphone" : "Unmute microphone"}
          title={enabled ? "Mute microphone" : "Unmute microphone"}
          className={cn(
            "relative grid h-11 w-14 place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            enabled ? "bg-secondary text-secondary-foreground hover:bg-accent" : "bg-destructive text-white hover:bg-destructive/90",
          )}
        >
          {enabled ? <Mic className="size-5" aria-hidden="true" /> : <MicOff className="size-5" aria-hidden="true" />}
          {enabled && candidateSpeaking ? (
            <span
              className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-primary/70 motion-reduce:hidden"
              style={{ transform: `scale(${1 + Math.min(micLevel, 1) * 0.28})`, opacity: 0.35 + Math.min(micLevel, 1) * 0.45 }}
              aria-hidden="true"
            />
          ) : null}
        </button>

        <Button
          size="icon"
          variant={roomToneEnabled ? "secondary" : "outline"}
          className="h-11 w-14 rounded-xl"
          onClick={toggleRoomTone}
          aria-pressed={roomToneEnabled}
          title={roomToneEnabled ? "Turn off room ambience" : "Play room ambience on this device only. It is never sent to the interviewers."}
          aria-label={roomToneEnabled ? "Turn off room ambience" : "Turn on room ambience"}
        >
          <Waves aria-hidden="true" />
        </Button>

        {/* Connection state only earns space when it needs attention. */}
        {!isConnected || displayedError ? (
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">{connectionStatus}</span>
        ) : (
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{connectionStatus}</span>
        )}
        {audioTracks.map((track) => <RemoteAudioTrack key={String(track.getUserId())} track={track} play />)}
      </div>
    </div>
  );
}
