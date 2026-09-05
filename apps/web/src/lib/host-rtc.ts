import type { ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import type { AgoraConfig, GuestSession } from "@/lib/api";

export type HostRtcMediaState = {
  cameraEnabled: boolean;
  localVideo: ICameraVideoTrack | null;
  remoteVideos: Array<{ uid: string; track: IRemoteVideoTrack }>;
};

export type HostRtcHandle = {
  leave: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
};

type HostRtcOptions = {
  renewConnection?: () => Promise<AgoraConfig>;
  onConnectionError?: (error: Error) => void;
  onMediaState?: (state: HostRtcMediaState) => void;
};

/** Join as a listener first. Microphone capture and publishing require an explicit click. */
export async function joinHostRtcRoom(
  session: GuestSession,
  options: HostRtcOptions = {},
): Promise<HostRtcHandle> {
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  let muted = false;
  let microphone: IMicrophoneAudioTrack | null = null;
  let camera: ICameraVideoTrack | null = null;
  let microphoneEnabled = false;
  let microphonePublished = false;
  let cameraEnabled = false;
  let cameraPublished = false;
  let closed = false;
  let mediaTask: Promise<void> = Promise.resolve();
  let leaveTask: Promise<void> | null = null;
  let renewalTask: Promise<void> | null = null;
  let rejoinTask: Promise<void> | null = null;

  const validateConnection = (connection: AgoraConfig) => {
    if (
      connection.app_id !== session.connection.app_id
      || connection.channel_name !== session.connection.channel_name
      || String(connection.uid) !== String(session.connection.uid)
    ) {
      throw new Error("The renewed guest token does not belong to this interview seat.");
    }
  };
  const reportConnectionError = (error: unknown) => options.onConnectionError?.(
    error instanceof Error ? error : new Error("The guest audio connection could not be recovered."),
  );
  const emitMediaState = () => options.onMediaState?.({
    cameraEnabled,
    localVideo: cameraEnabled ? camera : null,
    remoteVideos: client.remoteUsers.flatMap((user) => (
      user.hasVideo && user.videoTrack ? [{ uid: String(user.uid), track: user.videoTrack }] : []
    )),
  });
  const renewToken = () => {
    if (closed || !options.renewConnection) return Promise.resolve();
    if (rejoinTask) return rejoinTask;
    if (renewalTask) return renewalTask;
    const request = (async () => {
      const connection = await options.renewConnection?.();
      if (!connection || closed) return;
      validateConnection(connection);
      await client.renewToken(connection.token);
    })();
    renewalTask = request;
    void request
      .catch(reportConnectionError)
      .finally(() => {
        if (renewalTask === request) renewalTask = null;
      });
    return request;
  };
  const rejoinWithFreshToken = () => {
    if (closed || !options.renewConnection) return Promise.resolve();
    if (rejoinTask) return rejoinTask;
    const previousMediaTask = mediaTask;
    const request = (async () => {
      await renewalTask?.catch(() => undefined);
      const connection = await options.renewConnection?.();
      if (!connection || closed) return;
      validateConnection(connection);
      await previousMediaTask.catch(() => undefined);
      if (closed) return;

      // The installed Web SDK requires join(), not renewToken(), after the
      // did-expire event. Reuse the server-bound UID and then republish the
      // existing live microphone track without requesting device access again.
      microphonePublished = false;
      cameraPublished = false;
      await client.join(
        connection.app_id,
        connection.channel_name,
        connection.token,
        Number(connection.uid),
      );
      if (closed) return;
      if (microphone && microphoneEnabled) {
        await client.publish(microphone);
        microphonePublished = true;
      }
      if (camera && cameraEnabled) {
        await client.publish(camera);
        cameraPublished = true;
      }
      emitMediaState();
    })();
    rejoinTask = request;
    // Reserve the media queue immediately so microphone changes requested
    // during token recovery run only after the channel has been rejoined.
    mediaTask = request;
    void request
      .catch(reportConnectionError)
      .finally(() => {
        if (rejoinTask === request) rejoinTask = null;
      });
    return request;
  };
  const handleTokenWillExpire = () => { void renewToken(); };
  const handleTokenDidExpire = () => { void rejoinWithFreshToken(); };

  // Agora can report users already in the room as soon as join resolves, so
  // subscription handlers must be registered before joining.
  const handleUserPublished = (user: (typeof client.remoteUsers)[number], mediaType: "audio" | "video") => {
    if (closed) return;
    void client.subscribe(user, mediaType)
      .then(() => {
        if (closed) return;
        if (mediaType === "audio" && !muted) user.audioTrack?.play();
        if (mediaType === "video") emitMediaState();
      })
      .catch((error) => {
        console.warn(`Host ${mediaType} subscription failed`, error);
        reportConnectionError(new Error(`Could not subscribe to room ${mediaType}. Rejoin to restore the connection.`));
      });
  };
  const handleRemoteVideoChanged = () => {
    if (!closed) emitMediaState();
  };
  client.on("user-published", handleUserPublished);
  client.on("user-unpublished", handleRemoteVideoChanged);
  client.on("user-left", handleRemoteVideoChanged);
  if (options.renewConnection) {
    client.on("token-privilege-will-expire", handleTokenWillExpire);
    client.on("token-privilege-did-expire", handleTokenDidExpire);
  }

  await client.join(
    session.connection.app_id,
    session.connection.channel_name,
    session.connection.token,
    Number(session.connection.uid),
  );
  emitMediaState();

  return {
    leave: () => {
      if (leaveTask) return leaveTask;
      closed = true;
      leaveTask = (async () => {
        client.off("token-privilege-will-expire", handleTokenWillExpire);
        client.off("token-privilege-did-expire", handleTokenDidExpire);
        client.off("user-published", handleUserPublished);
        client.off("user-unpublished", handleRemoteVideoChanged);
        client.off("user-left", handleRemoteVideoChanged);
        await renewalTask?.catch(() => undefined);
        await rejoinTask?.catch(() => undefined);
        await mediaTask.catch(() => undefined);
        if (microphone) {
          if (microphonePublished) await client.unpublish(microphone).catch(() => undefined);
          microphone.stop();
          microphone.close();
          microphone = null;
          microphonePublished = false;
        }
        if (camera) {
          if (cameraPublished) await client.unpublish(camera).catch(() => undefined);
          camera.stop();
          camera.close();
          camera = null;
          cameraPublished = false;
          cameraEnabled = false;
        }
        await client.leave();
      })();
      return leaveTask;
    },
    setMuted: (next: boolean) => {
      if (closed) return;
      muted = next;
      for (const user of client.remoteUsers) {
        if (next) user.audioTrack?.stop();
        else user.audioTrack?.play();
      }
    },
    setMicrophoneEnabled: (enabled: boolean) => {
      if (closed) return Promise.reject(new Error("The interview room is already closed."));
      microphoneEnabled = enabled;
      const operation = mediaTask
        .catch(() => undefined)
        .then(async () => {
          if (closed) return;
          if (!enabled) {
            await microphone?.setEnabled(false);
            return;
          }
          if (!microphone) {
            const next = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
            microphone = next;
            try {
              if (closed) {
                microphone = null;
                next.stop();
                next.close();
                return;
              }
              await client.publish(next);
              microphonePublished = true;
            } catch (error) {
              microphone = null;
              next.stop();
              next.close();
              throw error;
            }
          }
          if (!microphonePublished) {
            await client.publish(microphone);
            microphonePublished = true;
          }
          if (!closed) await microphone.setEnabled(true);
        });
      mediaTask = operation;
      return operation;
    },
    setCameraEnabled: (enabled: boolean) => {
      if (closed) return Promise.reject(new Error("The interview room is already closed."));
      cameraEnabled = enabled;
      const operation = mediaTask
        .catch(() => undefined)
        .then(async () => {
          if (closed) return;
          if (!enabled) {
            await camera?.setEnabled(false);
            emitMediaState();
            return;
          }
          if (!camera) {
            const next = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "480p_1" });
            camera = next;
            try {
              if (closed) {
                camera = null;
                next.stop();
                next.close();
                return;
              }
              await client.publish(next);
              cameraPublished = true;
            } catch (error) {
              camera = null;
              next.stop();
              next.close();
              throw error;
            }
          }
          if (!cameraPublished) {
            await client.publish(camera);
            cameraPublished = true;
          }
          if (!closed) await camera.setEnabled(true);
          emitMediaState();
        });
      mediaTask = operation;
      return operation;
    },
  };
}
