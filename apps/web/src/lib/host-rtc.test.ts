import { beforeEach, describe, expect, it, vi } from "vitest";
import { joinHostRtcRoom } from "./host-rtc";
import type { GuestSession } from "./api";

const agora = vi.hoisted(() => {
  const microphone = {
    setEnabled: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    close: vi.fn(),
  };
  const camera = {
    setEnabled: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    close: vi.fn(),
  };
  const client = {
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(7001),
    leave: vi.fn().mockResolvedValue(undefined),
    off: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    renewToken: vi.fn().mockResolvedValue(undefined),
    unpublish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    remoteUsers: [] as Array<{
      uid: string | number;
      hasVideo?: boolean;
      audioTrack?: { play: () => void; stop: () => void };
      videoTrack?: { play: () => void; stop: () => void };
    }>,
  };
  return {
    client,
    microphone,
    camera,
    createClient: vi.fn(() => client),
    createMicrophoneAudioTrack: vi.fn().mockResolvedValue(microphone),
    createCameraVideoTrack: vi.fn().mockResolvedValue(camera),
  };
});

vi.mock("agora-rtc-sdk-ng", () => ({
  default: {
    createClient: agora.createClient,
    createMicrophoneAudioTrack: agora.createMicrophoneAudioTrack,
    createCameraVideoTrack: agora.createCameraVideoTrack,
  },
}));

const session = {
  session_id: "session-1",
  title: "Practice interview",
  role_pack: "Software engineer",
  status: "live",
  seat: "interviewer",
  display_name: "Human host",
  connection: {
    app_id: "app-id",
    channel_name: "room-1",
    token: "guest-token",
    uid: "7001",
    agent_uid: "9001",
  },
  panel: [],
  supports_coding: true,
  coding: { languages: ["python"], default_language: "python", prompt: "Solve the coding problem." },
  heartbeat_interval_seconds: 10,
} satisfies GuestSession;

beforeEach(() => {
  vi.clearAllMocks();
  agora.client.join.mockResolvedValue(7001);
  agora.client.leave.mockResolvedValue(undefined);
  agora.client.publish.mockResolvedValue(undefined);
  agora.client.unpublish.mockResolvedValue(undefined);
  agora.client.renewToken.mockResolvedValue(undefined);
  agora.client.subscribe.mockResolvedValue(undefined);
  agora.microphone.setEnabled.mockResolvedValue(undefined);
  agora.camera.setEnabled.mockResolvedValue(undefined);
  agora.createMicrophoneAudioTrack.mockResolvedValue(agora.microphone);
  agora.createCameraVideoTrack.mockResolvedValue(agora.camera);
  agora.client.remoteUsers.length = 0;
});

describe("human interviewer Agora room", () => {
  it("registers subscription before join and plays subscribed room audio", async () => {
    const room = await joinHostRtcRoom(session);
    expect(agora.client.on).toHaveBeenCalledWith("user-published", expect.any(Function));
    expect(agora.client.on.mock.invocationCallOrder[0]).toBeLessThan(agora.client.join.mock.invocationCallOrder[0]);
    expect(agora.client.join).toHaveBeenCalledWith("app-id", "room-1", "guest-token", 7001);

    const published = agora.client.on.mock.calls.find(([event]) => event === "user-published")?.[1] as (
      user: { audioTrack?: { play: () => void } },
      mediaType: "audio" | "video",
    ) => void;
    const audioTrack = { play: vi.fn() };
    published({ audioTrack }, "audio");
    await vi.waitFor(() => expect(agora.client.subscribe).toHaveBeenCalled());
    expect(audioTrack.play).toHaveBeenCalledOnce();

    await room.leave();
  });

  it("publishes only after the host enables their microphone and cleans up in order", async () => {
    const room = await joinHostRtcRoom(session);
    expect(agora.createMicrophoneAudioTrack).not.toHaveBeenCalled();

    await room.setMicrophoneEnabled(true);
    expect(agora.createMicrophoneAudioTrack).toHaveBeenCalledWith({ AEC: true, ANS: true, AGC: true });
    expect(agora.client.publish).toHaveBeenCalledWith(agora.microphone);
    expect(agora.microphone.setEnabled).toHaveBeenCalledWith(true);

    await room.setMicrophoneEnabled(false);
    expect(agora.microphone.setEnabled).toHaveBeenLastCalledWith(false);

    await room.leave();
    expect(agora.client.unpublish).toHaveBeenCalledWith(agora.microphone);
    expect(agora.microphone.stop).toHaveBeenCalledOnce();
    expect(agora.microphone.close).toHaveBeenCalledOnce();
    expect(agora.client.leave).toHaveBeenCalledOnce();
    expect(agora.microphone.stop.mock.invocationCallOrder[0]).toBeLessThan(agora.microphone.close.mock.invocationCallOrder[0]);
    expect(agora.microphone.close.mock.invocationCallOrder[0]).toBeLessThan(agora.client.leave.mock.invocationCallOrder[0]);
  });

  it("publishes the host camera on demand and releases it on leave", async () => {
    const onMediaState = vi.fn();
    const room = await joinHostRtcRoom(session, { onMediaState });
    expect(agora.createCameraVideoTrack).not.toHaveBeenCalled();

    await room.setCameraEnabled(true);
    expect(agora.createCameraVideoTrack).toHaveBeenCalledWith({ encoderConfig: "480p_1" });
    expect(agora.client.publish).toHaveBeenCalledWith(agora.camera);
    expect(agora.camera.setEnabled).toHaveBeenCalledWith(true);
    expect(onMediaState).toHaveBeenLastCalledWith(expect.objectContaining({
      cameraEnabled: true,
      localVideo: agora.camera,
    }));

    await room.setCameraEnabled(false);
    expect(agora.camera.setEnabled).toHaveBeenLastCalledWith(false);
    expect(onMediaState).toHaveBeenLastCalledWith(expect.objectContaining({
      cameraEnabled: false,
      localVideo: null,
    }));

    await room.leave();
    expect(agora.client.unpublish).toHaveBeenCalledWith(agora.camera);
    expect(agora.camera.stop).toHaveBeenCalledOnce();
    expect(agora.camera.close).toHaveBeenCalledOnce();
  });

  it("subscribes to remote video and exposes it to the room grid", async () => {
    const onMediaState = vi.fn();
    const room = await joinHostRtcRoom(session, { onMediaState });
    const published = agora.client.on.mock.calls.find(([event]) => event === "user-published")?.[1] as (
      user: (typeof agora.client.remoteUsers)[number],
      mediaType: "audio" | "video",
    ) => void;
    const videoTrack = { play: vi.fn(), stop: vi.fn() };
    const remoteUser = { uid: 4102, hasVideo: true, videoTrack };
    agora.client.remoteUsers.push(remoteUser);

    published(remoteUser, "video");

    await vi.waitFor(() => expect(agora.client.subscribe).toHaveBeenCalledWith(remoteUser, "video"));
    expect(onMediaState).toHaveBeenLastCalledWith(expect.objectContaining({
      remoteVideos: [{ uid: "4102", track: videoTrack }],
    }));
    await room.leave();
  });

  it("removes an unpublished remote camera instead of displaying a black tile", async () => {
    const onMediaState = vi.fn();
    const room = await joinHostRtcRoom(session, { onMediaState });
    const unpublished = agora.client.on.mock.calls.find(([event]) => event === "user-unpublished")?.[1] as () => void;
    const remoteUser = { uid: 4102, hasVideo: true, videoTrack: { play: vi.fn(), stop: vi.fn() } };
    agora.client.remoteUsers.push(remoteUser);
    unpublished();
    expect(onMediaState).toHaveBeenLastCalledWith(expect.objectContaining({
      remoteVideos: [{ uid: "4102", track: remoteUser.videoTrack }],
    }));

    remoteUser.hasVideo = false;
    unpublished();
    expect(onMediaState).toHaveBeenLastCalledWith(expect.objectContaining({ remoteVideos: [] }));
    await room.leave();
  });

  it("releases microphone capture when Agora rejects publishing", async () => {
    agora.client.publish.mockRejectedValueOnce(new Error("publisher privilege missing"));
    const room = await joinHostRtcRoom(session);

    await expect(room.setMicrophoneEnabled(true)).rejects.toThrow("publisher privilege missing");
    expect(agora.microphone.stop).toHaveBeenCalledOnce();
    expect(agora.microphone.close).toHaveBeenCalledOnce();
    expect(agora.microphone.setEnabled).not.toHaveBeenCalled();

    await room.leave();
  });

  it("waits for an in-flight publish before releasing the microphone", async () => {
    let finishPublish: (() => void) | undefined;
    agora.client.publish.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishPublish = resolve;
    }));
    const room = await joinHostRtcRoom(session);
    const enabling = room.setMicrophoneEnabled(true);
    await vi.waitFor(() => expect(agora.client.publish).toHaveBeenCalledOnce());

    const leaving = room.leave();
    expect(agora.client.leave).not.toHaveBeenCalled();
    finishPublish?.();
    await enabling;
    await leaving;

    expect(agora.client.unpublish).toHaveBeenCalledWith(agora.microphone);
    expect(agora.microphone.stop).toHaveBeenCalledOnce();
    expect(agora.microphone.close).toHaveBeenCalledOnce();
    expect(agora.client.leave).toHaveBeenCalledOnce();
  });

  it("does not resume media after the room has ended", async () => {
    const room = await joinHostRtcRoom(session);
    const published = agora.client.on.mock.calls.find(([event]) => event === "user-published")?.[1] as (
      user: { audioTrack?: { play: () => void } },
      mediaType: "audio" | "video",
    ) => void;
    const audioTrack = { play: vi.fn() };

    await room.leave();
    await room.leave();
    published({ audioTrack }, "audio");

    expect(agora.client.subscribe).not.toHaveBeenCalled();
    expect(audioTrack.play).not.toHaveBeenCalled();
    await expect(room.setMicrophoneEnabled(true)).rejects.toThrow("already closed");
    expect(agora.createMicrophoneAudioTrack).not.toHaveBeenCalled();
    expect(agora.client.leave).toHaveBeenCalledOnce();
  });

  it("renews an expiring guest token without changing the Agora seat", async () => {
    const renewConnection = vi.fn().mockResolvedValue({
      ...session.connection,
      token: "fresh-guest-token",
    });
    const onConnectionError = vi.fn();
    const room = await joinHostRtcRoom(session, { renewConnection, onConnectionError });
    const expiring = agora.client.on.mock.calls.find(
      ([event]) => event === "token-privilege-will-expire",
    )?.[1] as () => void;

    expiring();

    await vi.waitFor(() => expect(agora.client.renewToken).toHaveBeenCalledWith("fresh-guest-token"));
    expect(renewConnection).toHaveBeenCalledOnce();
    expect(onConnectionError).not.toHaveBeenCalled();
    await room.leave();
    expect(agora.client.off).toHaveBeenCalledWith("token-privilege-will-expire", expiring);
  });

  it("rejoins with the same UID after expiry and republishes an enabled microphone", async () => {
    const renewConnection = vi.fn().mockResolvedValue({
      ...session.connection,
      token: "fresh-guest-token",
    });
    const onConnectionError = vi.fn();
    const room = await joinHostRtcRoom(session, { renewConnection, onConnectionError });
    await room.setMicrophoneEnabled(true);
    const expired = agora.client.on.mock.calls.find(
      ([event]) => event === "token-privilege-did-expire",
    )?.[1] as () => void;

    expired();

    await vi.waitFor(() => expect(agora.client.join).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(agora.client.publish).toHaveBeenCalledTimes(2));
    expect(agora.client.join).toHaveBeenLastCalledWith("app-id", "room-1", "fresh-guest-token", 7001);
    expect(agora.client.renewToken).not.toHaveBeenCalled();
    expect(agora.createMicrophoneAudioTrack).toHaveBeenCalledOnce();
    expect(onConnectionError).not.toHaveBeenCalled();

    await room.leave();
    expect(agora.client.off).toHaveBeenCalledWith("token-privilege-did-expire", expired);
  });

  it("republishes an enabled camera after token-expiry rejoin", async () => {
    const renewConnection = vi.fn().mockResolvedValue({
      ...session.connection,
      token: "fresh-guest-token",
    });
    const room = await joinHostRtcRoom(session, { renewConnection });
    await room.setCameraEnabled(true);
    agora.client.publish.mockClear();
    const expired = agora.client.on.mock.calls.find(
      ([event]) => event === "token-privilege-did-expire",
    )?.[1] as () => void;

    expired();

    await vi.waitFor(() => expect(agora.client.join).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(agora.client.publish).toHaveBeenCalledWith(agora.camera));
    expect(agora.createCameraVideoTrack).toHaveBeenCalledOnce();

    await room.leave();
  });

  it("keeps a disabled microphone off after rejoin and republishes it when enabled again", async () => {
    const renewConnection = vi.fn().mockResolvedValue({
      ...session.connection,
      token: "fresh-guest-token",
    });
    const room = await joinHostRtcRoom(session, { renewConnection });
    await room.setMicrophoneEnabled(true);
    await room.setMicrophoneEnabled(false);
    agora.client.publish.mockClear();
    const expired = agora.client.on.mock.calls.find(
      ([event]) => event === "token-privilege-did-expire",
    )?.[1] as () => void;

    expired();

    await vi.waitFor(() => expect(agora.client.join).toHaveBeenCalledTimes(2));
    expect(agora.client.publish).not.toHaveBeenCalled();
    await room.setMicrophoneEnabled(true);
    expect(agora.client.publish).toHaveBeenCalledWith(agora.microphone);
    expect(agora.createMicrophoneAudioTrack).toHaveBeenCalledOnce();

    await room.leave();
  });

  it("queues microphone changes requested while an expired token is being replaced", async () => {
    let finishRenewal: ((connection: typeof session.connection) => void) | undefined;
    const renewConnection = vi.fn(() => new Promise<typeof session.connection>((resolve) => {
      finishRenewal = resolve;
    }));
    const room = await joinHostRtcRoom(session, { renewConnection });
    const expired = agora.client.on.mock.calls.find(
      ([event]) => event === "token-privilege-did-expire",
    )?.[1] as () => void;

    expired();
    const enabling = room.setMicrophoneEnabled(true);
    await vi.waitFor(() => expect(renewConnection).toHaveBeenCalledOnce());
    expect(agora.createMicrophoneAudioTrack).not.toHaveBeenCalled();
    finishRenewal?.({ ...session.connection, token: "fresh-guest-token" });
    await enabling;

    expect(agora.client.join).toHaveBeenCalledTimes(2);
    expect(agora.createMicrophoneAudioTrack).toHaveBeenCalledOnce();
    expect(agora.client.join.mock.invocationCallOrder[1])
      .toBeLessThan(agora.createMicrophoneAudioTrack.mock.invocationCallOrder[0]);
    expect(agora.client.publish).toHaveBeenCalledWith(agora.microphone);

    await room.leave();
  });
});
