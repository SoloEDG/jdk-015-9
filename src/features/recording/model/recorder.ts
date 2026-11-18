import { reactive } from "vue";
import type { Take, TakeEvent } from "../../../shared/types";
import { recordingMime, takeName } from "../lib/format";
import { createCaptureLog, type CaptureLogEvent } from "../lib/captureLog";
export function createRecorder() {
  const state = reactive({
    status: "idle",
    error: "",
    elapsed: 0,
    takes: [] as Take[],
    events: 0,
    activeTakeId: "",
  });
  const log = createCaptureLog();
  let recorder: MediaRecorder | undefined,
    chunks: Blob[] = [],
    started = 0,
    timer = 0,
    video: MediaStream | undefined;
  function start(canvas: HTMLCanvasElement, audio: MediaStream) {
    if (state.status !== "idle") return;
    state.error = "";
    try {
      if (!window.MediaRecorder || !canvas.captureStream)
        throw Error("此浏览器不支持舞台录制");
      video = canvas.captureStream(30);
      const stream = new MediaStream([
        ...video.getVideoTracks(),
        ...audio.getAudioTracks(),
      ]);
      const mime = recordingMime();
      recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunks = [];
      // beat marks are stored on the take's own clock, starting at zero when
      // the recorder starts (songPosition is kept for callers that need it)
      log.begins();
      state.events = 0;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || mime });
        const events = log.snapshot(state.elapsed);
        const id = crypto.randomUUID();
        state.takes.unshift({
          id,
          url: URL.createObjectURL(blob),
          size: blob.size,
          duration: state.elapsed,
          name: takeName(blob.type),
          mime: blob.type,
          events,
        });
        state.activeTakeId = id;
        state.events = events.length;
        video?.getTracks().forEach((t) => t.stop());
        state.status = "idle";
      };
      recorder.onerror = () => {
        state.error = "录制失败，请重新开始";
        stop();
      };
      recorder.start(1000);
      started = performance.now();
      state.elapsed = 0;
      state.status = "recording";
      timer = window.setInterval(() => {
        state.elapsed = (performance.now() - started) / 1000;
      }, 100);
    } catch (e) {
      video?.getTracks().forEach((t) => t.stop());
      state.error = e instanceof Error ? e.message : "无法开始录制";
      state.status = "idle";
    }
  }
  function stop() {
    if (recorder?.state === "recording") {
      state.status = "saving";
      clearInterval(timer);
      recorder.stop();
    }
  }
  /** Log a musical or scene event against the take in progress. */
  function mark(event: CaptureLogEvent) {
    if (state.status !== "recording") return false;
    const ok = log.record(event, (performance.now() - started) / 1000);
    if (ok) state.events = log.count();
    return ok;
  }
  function remove(id: string) {
    const i = state.takes.findIndex((t) => t.id === id);
    if (i >= 0) {
      URL.revokeObjectURL(state.takes[i].url);
      state.takes.splice(i, 1);
      if (state.activeTakeId === id) state.activeTakeId = "";
    }
  }
  function dispose() {
    stop();
    state.takes.forEach((t) => URL.revokeObjectURL(t.url));
  }
  return { state, start, stop, mark, remove, dispose };
}
export type StageRecorder = ReturnType<typeof createRecorder>;
export type { TakeEvent };
