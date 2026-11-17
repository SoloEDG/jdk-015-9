import { reactive, shallowRef } from "vue";
import type { Analysis, StageDocument } from "../../../shared/types";
import { analyse } from "../lib/analyse";
import { demoBuffer } from "../lib/demo";
export function createAudio(doc: StageDocument) {
  const state = reactive({
    playing: false,
    source: "demo",
    name: "Midnight / 120 BPM",
    duration: 16,
    position: 0,
    error: "",
    loading: false,
  });
  const frame = shallowRef<Analysis>({
    bins: Array(128).fill(0),
    wave: Array(256).fill(0),
    rms: 0,
    bass: 0,
    beat: false,
    time: 0,
  });
  let ctx: AudioContext,
    analyser: AnalyserNode,
    gain: GainNode,
    destination: MediaStreamAudioDestinationNode;
  let buffer: AudioBuffer,
    node: AudioBufferSourceNode | MediaStreamAudioSourceNode | undefined,
    mic: MediaStream | undefined;
  let origin = 0,
    offset = 0,
    epoch = 0,
    raf = 0;
  function init() {
    if (ctx) return;
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    gain = ctx.createGain();
    destination = ctx.createMediaStreamDestination();
    analyser.connect(gain);
    gain.connect(ctx.destination);
    analyser.connect(destination);
    buffer = demoBuffer(ctx);
  }
  function detach() {
    if (node) {
      if (node instanceof AudioBufferSourceNode) {
        node.onended = null;
        try {
          node.stop();
        } catch {}
      }
      node.disconnect();
      node = undefined;
    }
    mic?.getTracks().forEach((t) => t.stop());
    mic = undefined;
  }
  function pump() {
    if (!ctx) return;
    const f = new Uint8Array(analyser.frequencyBinCount),
      w = new Uint8Array(analyser.fftSize);
    analyser.smoothingTimeConstant = doc.smoothing;
    gain.gain.value = state.source === "mic" ? 0 : doc.gain;
    analyser.getByteFrequencyData(f);
    analyser.getByteTimeDomainData(w);
    state.position = state.playing ? offset + ctx.currentTime - origin : offset;
    frame.value = analyse(
      f,
      w,
      state.position,
      doc.sensitivity,
      frame.value.bass,
    );
    raf = requestAnimationFrame(pump);
  }
  async function play() {
    init();
    await ctx.resume();
    if (state.playing) return;
    if (state.source === "mic") {
      await microphone();
      return;
    }
    node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(analyser);
    origin = ctx.currentTime;
    node.start(0, offset % buffer.duration);
    state.playing = true;
    if (!raf) pump();
  }
  function pause() {
    if (!state.playing) return;
    offset = state.position;
    detach();
    state.playing = false;
  }
  async function file(file: File) {
    init();
    const ticket = ++epoch;
    state.loading = true;
    state.error = "";
    try {
      const next = await ctx.decodeAudioData(await file.arrayBuffer());
      if (ticket !== epoch) return;
      detach();
      buffer = next;
      offset = 0;
      state.position = 0;
      state.playing = false;
      state.source = "file";
      state.name = file.name;
      state.duration = next.duration;
      await play();
    } catch {
      if (ticket === epoch)
        state.error = "无法解码此音频，请选择有效的音频文件。";
    } finally {
      if (ticket === epoch) state.loading = false;
    }
  }
  async function microphone() {
    init();
    const ticket = ++epoch;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket !== epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      detach();
      mic = stream;
      node = ctx.createMediaStreamSource(stream);
      node.connect(analyser);
      state.source = "mic";
      state.name = "Live microphone";
      state.playing = true;
      offset = 0;
      origin = ctx.currentTime;
      await ctx.resume();
      if (!raf) pump();
    } catch {
      state.error = "麦克风不可用或未获授权，原有音源已保留。";
    }
  }
  async function demo() {
    init();
    ++epoch;
    detach();
    buffer = demoBuffer(ctx);
    state.source = "demo";
    state.name = "Midnight / 120 BPM";
    offset = 0;
    state.playing = false;
    state.duration = 16;
    await play();
  }
  function dispose() {
    ++epoch;
    cancelAnimationFrame(raf);
    detach();
    void ctx?.close();
  }
  return {
    state,
    frame,
    play,
    pause,
    file,
    microphone,
    demo,
    dispose,
    stream: () => {
      init();
      return destination.stream;
    },
  };
}
export type AudioEngine = ReturnType<typeof createAudio>;
