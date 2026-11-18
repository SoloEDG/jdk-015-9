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
    /** bumped whenever a new decodable buffer becomes the current one */
    loadedTick: 0,
    /** bumped on every transport jump so musical counters can resynchronise */
    seekTick: 0,
    /** bumped each time a loop passes back to its start */
    passTick: 0,
    /** whether a sample buffer is available for offline beat analysis */
    analysable: false,
    loop: { enabled: false, start: 0, end: 16 },
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
    raf = 0,
    suppressPass = false;
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
    state.analysable = state.source !== "mic";
    // the first buffer is now available; let waveform views pick it up
    state.loadedTick++;
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
  function effectiveLoop() {
    const duration = buffer?.duration || state.duration;
    const l = state.loop;
    if (l.enabled && l.end > l.start + 0.02) {
      return {
        enabled: true,
        start: Math.max(0, Math.min(l.start, duration)),
        end: Math.min(duration, l.end),
      };
    }
    return { enabled: false, start: 0, end: duration };
  }
  /** Fold a raw timeline value into the active loop range. */
  function fold(raw: number) {
    const l = effectiveLoop(),
      len = l.end - l.start;
    if (!l.enabled || len <= 0.02) {
      return buffer ? raw % buffer.duration : raw;
    }
    if (raw <= l.end) return raw;
    return l.start + ((raw - l.start) % len);
  }
  function pump() {
    if (!ctx) return;
    const f = new Uint8Array(analyser.frequencyBinCount),
      w = new Uint8Array(analyser.fftSize);
    analyser.smoothingTimeConstant = doc.smoothing;
    gain.gain.value = state.source === "mic" ? 0 : doc.gain;
    analyser.getByteFrequencyData(f);
    analyser.getByteTimeDomainData(w);
    const previousPosition = state.position;
    state.position = state.playing ? fold(offset + ctx.currentTime - origin) : offset;
    if (state.playing && state.position < previousPosition - 0.1) {
      // a restart from startBuffer already moved the position, so the flag is
      // consumed on the first frame regardless of whether a wrap was seen
      if (!suppressPass) state.passTick++;
    }
    suppressPass = false;
    frame.value = analyse(
      f,
      w,
      state.position,
      doc.sensitivity,
      frame.value.bass,
    );
    raf = requestAnimationFrame(pump);
  }
  function applyLoop(source: AudioBufferSourceNode) {
    const l = effectiveLoop();
    source.loop = true;
    source.loopStart = l.start;
    source.loopEnd = l.end || source.buffer?.duration || 0;
  }
  function startBuffer(at: number) {
    if (!ctx || !buffer) return;
    node?.disconnect();
    if (node instanceof AudioBufferSourceNode) {
      node.onended = null;
      try {
        node.stop();
      } catch {}
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    applyLoop(source);
    source.connect(analyser);
    const l = effectiveLoop(),
      len = l.end - l.start;
    let start = Math.max(0, Math.min(at, buffer.duration));
    if (l.enabled && len > 0.02 && start >= l.end) start = l.start;
    source.start(0, start % buffer.duration);
    node = source;
    offset = start;
    origin = ctx.currentTime;
    state.position = start;
    // restarting mid-loop can look like a wrap; it is a seek, not a new pass
    suppressPass = true;
  }
  async function play() {
    init();
    await ctx.resume();
    if (state.playing) return;
    if (state.source === "mic") {
      await microphone();
      return;
    }
    startBuffer(offset);
    state.playing = true;
    if (!raf) pump();
  }
  function pause() {
    if (!state.playing) return;
    offset = state.position;
    detach();
    state.playing = false;
  }
  /** Jump the transport. Works while paused and while playing. */
  function seek(time: number) {
    const duration = buffer?.duration || state.duration;
    let t = Math.max(0, Math.min(time, Math.max(0, duration - 0.001)));
    const l = effectiveLoop();
    if (l.enabled && (t < l.start || t >= l.end)) {
      const len = Math.max(0.02, l.end - l.start);
      t = l.start + ((((t - l.start) % len) + len) % len);
    }
    offset = t;
    state.position = t;
    state.seekTick++;
    if (state.playing) startBuffer(t);
  }
  /** Configure a musical loop. Enabling it restarts the source in place. */
  function setLoop(start: number, end: number, enabled = true) {
    const duration = buffer?.duration || state.duration;
    const a = Math.max(0, Math.min(start, duration));
    const b = Math.max(0, Math.min(end, duration));
    state.loop.start = Math.min(a, b);
    state.loop.end = Math.max(a, b);
    state.loop.enabled = enabled && state.loop.end - state.loop.start > 0.05;
    state.seekTick++;
    if (state.playing) startBuffer(state.position);
  }
  /** Move one loop edge, keeping the two edges from crossing. */
  function setLoopEdge(edge: "start" | "end", time: number) {
    const duration = buffer?.duration || state.duration;
    const t = Math.max(0, Math.min(time, duration));
    const loop = state.loop;
    if (edge === "start") setLoop(Math.min(t, loop.end - 0.06), loop.end, true);
    else setLoop(loop.start, Math.max(t, loop.start + 0.06), true);
  }
  function setLoopEnabled(enabled: boolean) {
    state.loop.enabled =
      enabled && state.loop.end - state.loop.start > 0.05;
    state.seekTick++;
    if (state.playing) startBuffer(state.position);
  }
  function clearLoop() {
    state.loop.enabled = false;
    state.loop.start = 0;
    state.loop.end = buffer?.duration || state.duration;
    state.seekTick++;
    if (state.playing) startBuffer(state.position);
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
      state.loop = { enabled: false, start: 0, end: next.duration };
      // signal load before auto-play so the beat grid resets first
      state.loadedTick++;
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
      state.loop = { enabled: false, start: 0, end: 0 };
      state.analysable = false;
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
    state.position = 0;
    state.playing = false;
    state.duration = 16;
    state.loop = { enabled: false, start: 0, end: 16 };
    state.analysable = true;
    state.loadedTick++;
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
    seek,
    setLoop,
    setLoopEdge,
    setLoopEnabled,
    clearLoop,
    file,
    microphone,
    demo,
    dispose,
    buffer: () => buffer,
    sampleRate: () => ctx?.sampleRate || 48000,
    /** whether a sample-accurate buffer is available for offline analysis */
    analysable: () => state.analysable && !!buffer,
    stream: () => {
      init();
      return destination.stream;
    },
  };
}
export type AudioEngine = ReturnType<typeof createAudio>;
