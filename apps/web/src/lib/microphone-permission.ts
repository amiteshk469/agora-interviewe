/** Request audio independently so a denied camera cannot block the conversation. */
export async function checkMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires HTTPS and a supported browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  try {
    if (!stream.getAudioTracks().length) throw new Error("No microphone was found. Connect one and try again.");
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
