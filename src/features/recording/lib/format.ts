export function recordingMime() {
  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
  );
}
export function takeName(mime: string) {
  return `Resonance-${new Date().toISOString().replace(/[:.]/g, "-")}.${mime.includes("mp4") ? "mp4" : "webm"}`;
}
