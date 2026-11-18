import { reactive, watch } from "vue";
import type { AudioEngine } from "../../audio/model/engine";
import type { BeatGrid, BeatLocation, GridBar } from "../lib/grid";
import {
  barEnd,
  beatDuration,
  locate,
  refreshBpm,
  stableBpm,
  rescaleGrid,
  shiftBar,
  setUncertain,
  moveBar,
} from "../lib/grid";
import type { Candidate } from "../lib/detect";
import { detectCandidates, type DetectResult } from "../lib/detect";

export type BeatEventKind = "bar" | "beat" | "manual" | "scene";
export interface BeatEvent {
  kind: BeatEventKind;
  songTime: number;
  bar?: number;
  beat?: number;
  bpm?: number;
  label?: string;
  uncertain?: boolean;
}

export interface BeatState {
  grid: BeatGrid | null;
  appliedCandidateId: string;
  status: "idle" | "detecting" | "ready" | "applied" | "error";
  candidates: Candidate[];
  detected: DetectResult | null;
  error: string;
  autoNotice: string;
  tapActive: boolean;
  tapBpm: number;
  tapCount: number;
  displayBpm: number;
  pulse: number;
  flash: boolean;
  flashBar: number;
  flashBeat: number;
  flashManual: boolean;
  location: BeatLocation | null;
  pendingScene: string;
  preview: { playing: boolean; from: number; to: number; label: string };
  gridVersion: number;
}

const STOP_TAP_MS = 3200;

export function createBeat(audio: AudioEngine) {
  const state = reactive<BeatState>({
    grid: null,
    appliedCandidateId: "",
    status: "idle",
    candidates: [],
    detected: null,
    error: "",
    autoNotice: "",
    tapActive: false,
    tapBpm: 120,
    tapCount: 0,
    displayBpm: 120,
    pulse: 0,
    flash: false,
    flashBar: 0,
    flashBeat: 0,
    flashManual: false,
    location: null,
    pendingScene: "",
    preview: { playing: false, from: 0, to: 0, label: "" },
    gridVersion: 0,
  });

  let sink: ((event: BeatEvent) => void) | undefined;
  let pendingScene: (() => void) | null = null;
  let raf = 0,
    lastPos = -1,
    lastBeatStart = -Infinity,
    wasPlaying = false,
    seenSeek = audio.state.seekTick,
    seenLoaded = audio.state.loadedTick,
    seenPass = audio.state.passTick,
    flashTimer = 0,
    tapTimes: number[] = [],
    tapTimer = 0,
    sceneExpiry = 0,
    detectTicket = 0,
    previewCtx: AudioContext | undefined,
    previewNode: AudioBufferSourceNode | undefined,
    previewRaf = 0;

  function setEventSink(fn: (event: BeatEvent) => void) {
    sink = fn;
  }
  function emit(event: BeatEvent) {
    sink?.(event);
  }

  function flash(bar: number, beat: number, manual = false) {
    state.pulse++;
    state.flash = true;
    state.flashBar = bar;
    state.flashBeat = beat;
    state.flashManual = manual;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (state.flash = false), 110);
  }

  function reanchor(pos = audio.state.position) {
    lastPos = pos;
    const grid = state.grid;
    if (!grid) {
      lastBeatStart = -Infinity;
      return;
    }
    // Anchor to the beat we are already inside so edits/seeks/tap hand-over
    // never replay beats (or scene cues) that have already happened.
    lastBeatStart = locate(grid, pos).beatStart;
  }

  /** A beat that falls outside an active loop cannot fire in this pass. */
  function inLoopRange(time: number) {
    const loop = audio.state.loop;
    if (!loop.enabled) return true;
    return time >= loop.start - 0.01 && time < loop.end - 0.01;
  }

  function updateLocation() {
    const grid = state.grid;
    if (!grid) {
      state.location = null;
      if (!state.tapActive) state.displayBpm = state.tapBpm;
      return;
    }
    const loc = locate(grid, audio.state.position);
    state.location = loc;
    state.displayBpm = state.tapActive
      ? state.tapBpm
      : stableBpm(grid, loc.barNumber);
  }

  function fireDownbeat(loc: BeatLocation) {
    if (!pendingScene) return;
    const run = pendingScene;
    pendingScene = null;
    state.pendingScene = "";
    clearTimeout(sceneExpiry);
    run();
  }

  function emitGridBeat(loc: BeatLocation) {
    const kind: BeatEventKind = loc.beatNumber === 0 ? "bar" : "beat";
    flash(loc.barNumber, loc.beatNumber);
    // keep the readout in step with the beat that is firing
    state.location = loc;
    emit({
      kind,
      songTime: audio.state.position,
      bar: loc.barNumber,
      beat: loc.beatNumber,
      bpm: state.grid
        ? stableBpm(state.grid, loc.barNumber)
        : Math.round(60 / Math.max(0.05, loc.beatDuration)),
      uncertain: loc.uncertain,
    });
    if (loc.beatNumber === 0) fireDownbeat(loc);
  }

  function frame() {
    const pos = audio.state.position;
    const playing = audio.state.playing && audio.state.source !== "mic";
    const grid = state.grid;
    if (audio.state.seekTick !== seenSeek) {
      seenSeek = audio.state.seekTick;
      reanchor(pos);
    }
    if (audio.state.loadedTick !== seenLoaded) {
      seenLoaded = audio.state.loadedTick;
      reanchor(pos);
    }
    if (audio.state.passTick !== seenPass) {
      seenPass = audio.state.passTick;
      // A loop wrapped: the same musical bar comes round again. The bar number
      // is a property of the grid, so it is re-derived from position, and the
      // downbeat may legitimately flash again for the new pass.
      reanchor(pos);
      lastPos = pos;
      const loc = grid ? locate(grid, pos) : null;
      if (
        grid &&
        playing &&
        !state.tapActive &&
        loc &&
        loc.beatNumber === 0 &&
        pos - loc.beatStart < 0.06
      )
        emitGridBeat(loc);
    }
    if (!grid || !playing) {
      lastPos = pos;
      wasPlaying = false;
      // a pause forgets what fired, so resuming on a downbeat can light it
      if (grid) {
        const loc = locate(grid, pos);
        lastBeatStart = loc.beatStart;
      }
      updateLocation();
      raf = requestAnimationFrame(frame);
      return;
    }
    if (!wasPlaying) {
      // On play/resume the beat we are inside counts as already started, so it
      // is not replayed; only a near-exact downbeat lights up.
      const entry = locate(grid, pos);
      const onDownbeat =
        entry.beatNumber === 0 && pos - entry.beatStart < 0.06;
      lastBeatStart = onDownbeat
        ? entry.beatStart - 1e-3
        : entry.beatStart;
    }
    const loc = locate(grid, pos);
    const bd = Math.max(0.05, loc.beatDuration);
    const backwards = pos < lastPos - 0.02;
    const jumped = lastPos >= 0 && pos - lastPos > Math.max(0.3, bd * 1.8);
    if (backwards || jumped) {
      reanchor(pos);
    } else if (!state.tapActive && loc.beatStart !== lastBeatStart) {
      // Only a beat whose start actually elapsed since the previous frame may
      // fire. A downbeat revealed by dragging a bar backwards is *not* newly
      // elapsed, and must never re-trigger the scene it already triggered.
      const fresh =
        loc.beatStart > lastBeatStart &&
        pos - loc.beatStart <= Math.max(0.12, bd * 0.5);
      lastBeatStart = loc.beatStart;
      if (fresh && inLoopRange(loc.beatStart)) emitGridBeat(loc);
    }
    lastPos = pos;
    wasPlaying = playing;
    updateLocation();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  async function analyse() {
    state.error = "";
    state.autoNotice = "";
    if (!audio.analysable()) {
      state.error = "实时麦克风没有可分析的录音，请载入本地音频后再识别。";
      state.status = "error";
      return;
    }
    const buffer = audio.buffer();
    if (!buffer) {
      state.status = "idle";
      return;
    }
    const ticket = ++detectTicket;
    state.status = "detecting";
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (ticket !== detectTicket) return;
    try {
      const result = detectCandidates(buffer);
      if (ticket !== detectTicket) return;
      state.detected = result;
      state.candidates = result.candidates;
      state.status = result.candidates.length ? "ready" : "error";
      state.autoNotice = result.candidates.length
        ? `自动识别出 ${result.candidates.length} 个候选，尚未改变现场节拍。`
        : "未找到可靠的强拍候选，可手动敲击建立网格。";
      if (!result.candidates.length)
        state.error = "鼓点较弱或节拍不明确，请试听并手动校准。";
    } catch {
      if (ticket === detectTicket) {
        state.status = "error";
        state.error = "节拍分析失败，可改用手动敲击建立网格。";
      }
    }
  }

  function adopt(candidate: Candidate) {
    const grid: BeatGrid = {
      id: `grid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      bpm: candidate.bpm,
      beatsPerBar: 4,
      duration: candidate.duration,
      sourceName: candidate.label,
      createdAt: Date.now(),
      bars: candidate.bars.map((b) => ({ ...b })),
    };
    refreshBpm(grid);
    state.grid = grid;
    state.appliedCandidateId = candidate.id;
    state.status = "applied";
    state.error = "";
    state.autoNotice = "网格已确认：节拍指示、场景触发与录制事件将统一使用它。";
    state.gridVersion++;
    reanchor();
  }

  function adoptManualGrid(bpm: number) {
    const duration = audio.buffer()?.duration ?? audio.state.duration;
    const beatLength = 60 / Math.max(30, Math.min(240, bpm));
    const barLength = beatLength * 4;
    const bars: GridBar[] = [];
    for (let t = 0, i = 1; t < duration - 0.02; t += barLength, i++)
      bars.push({
        index: i,
        time: t,
        confidence: 0.5,
        uncertain: true,
        source: "edited",
      });
    if (!bars.length)
      bars.push({
        index: 1,
        time: 0,
        confidence: 0.5,
        uncertain: true,
        source: "edited",
      });
    const grid: BeatGrid = {
      id: `grid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      bpm: Math.round(bpm),
      beatsPerBar: 4,
      duration,
      sourceName: `手动 ${Math.round(bpm)} BPM`,
      createdAt: Date.now(),
      bars,
    };
    state.grid = grid;
    state.appliedCandidateId = "";
    state.status = "applied";
    state.autoNotice =
      "已建立手动网格，所有小节标记为待确认；可拖动强拍或用敲击修正。";
    state.gridVersion++;
    reanchor();
  }

  function clearGrid() {
    state.grid = null;
    state.appliedCandidateId = "";
    state.status = state.candidates.length ? "ready" : "idle";
    state.autoNotice = "网格已移除，现场回到即时触发。";
    state.gridVersion++;
    lastBeatStart = -Infinity;
    if (pendingScene) {
      const run = pendingScene;
      pendingScene = null;
      state.pendingScene = "";
      run();
    }
  }

  /** Re-anchor after a grid edit so already-played bars never replay. */
  function touchGrid() {
    state.gridVersion++;
    reanchor();
  }

  function moveDownbeat(barNumber: number, time: number) {
    if (!state.grid) return false;
    const moved = moveBar(state.grid, barNumber, time);
    if (moved) touchGrid();
    return moved;
  }

  function nudgeDownbeat(barNumber: number, delta: number) {
    if (!state.grid) return false;
    const moved = shiftBar(state.grid, barNumber, delta);
    if (moved) touchGrid();
    return moved;
  }

  function markUncertain(barNumber: number, uncertain: boolean) {
    if (!state.grid) return false;
    const ok = setUncertain(state.grid, barNumber, uncertain);
    if (ok) touchGrid();
    return ok;
  }

  function setBeatsPerBar(n: number) {
    if (!state.grid) return;
    state.grid.beatsPerBar = Math.max(2, Math.min(8, Math.round(n)));
    touchGrid();
  }

  /** Reinterpret every bar as half/double time, keeping the same musical map. */
  function rescale(factor: 2 | 0.5) {
    if (!state.grid) return;
    const next = rescaleGrid(state.grid, factor);
    state.grid = next;
    state.appliedCandidateId = "";
    state.autoNotice =
      factor === 2
        ? "已按半速理解：两小节合并为一个小节。"
        : "已按双速理解：每小节拆成两个。";
    touchGrid();
  }

  /** Nudge the whole grid earlier/later without touching tempo. */
  function shiftGrid(delta: number) {
    const grid = state.grid;
    if (!grid || !grid.bars.length) return;
    const first = grid.bars[0];
    const last = grid.bars[grid.bars.length - 1];
    if (first.time + delta < 0) return;
    if (last.time + delta > grid.duration - 0.03) return;
    grid.bars.forEach((b) => {
      b.time += delta;
      b.source = "edited";
    });
    touchGrid();
  }

  function queueScene(run: () => void, label: string) {
    if (!state.grid || !audio.state.playing || state.tapActive) {
      run();
      emit({
        kind: "scene",
        songTime: audio.state.position,
        bar: state.location?.barNumber,
        beat: state.location?.beatNumber,
        label,
      });
      return;
    }
    // quantised cue: wait for the next downbeat, and say so if none arrives
    pendingScene = () => {
      run();
      emit({
        kind: "scene",
        songTime: audio.state.position,
        bar: state.location?.barNumber,
        beat: state.location?.beatNumber,
        label,
      });
    };
    state.pendingScene = label;
    clearTimeout(sceneExpiry);
    sceneExpiry = window.setTimeout(() => cancelQueuedScene(), 9000);
  }
  function cancelQueuedScene() {
    clearTimeout(sceneExpiry);
    pendingScene = null;
    state.pendingScene = "";
  }

  function tap() {
    const now = performance.now();
    tapTimes = [...tapTimes.filter((t) => now - t < 3000), now].slice(-8);
    state.tapCount = tapTimes.length;
    if (tapTimes.length > 1)
      state.tapBpm = Math.round(
        (60000 * (tapTimes.length - 1)) / (now - tapTimes[0]),
      );
    state.tapActive = true;
    state.displayBpm = state.tapBpm;
    const loc = state.location;
    flash(loc?.barNumber ?? 0, loc?.beatNumber ?? 0, true);
    emit({
      kind: "manual",
      songTime: audio.state.position,
      bar: loc?.barNumber,
      beat: loc?.beatNumber,
      bpm: state.tapBpm,
      label: `TAP ${state.tapBpm} BPM`,
    });
    // grid stays intact while the manual tempo has the floor
    clearTimeout(tapTimer);
    tapTimer = window.setTimeout(releaseTap, STOP_TAP_MS);
  }

  function releaseTap() {
    clearTimeout(tapTimer);
    if (!state.tapActive) return;
    state.tapActive = false;
    tapTimes = [];
    state.tapCount = 0;
    // hand control back without replaying the beats that elapsed during taps
    reanchor(audio.state.position);
    updateLocation();
  }

  function stopPreview() {
    if (previewNode) {
      try {
        previewNode.stop();
      } catch {}
      previewNode.disconnect();
      previewNode = undefined;
    }
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    state.preview.playing = false;
    state.preview.label = "";
  }

  function audition(from: number, to: number, label = "", loop = true) {
    stopPreview();
    const buffer = audio.buffer();
    if (!buffer) return false;
    const start = Math.max(0, Math.min(from, buffer.duration - 0.05));
    let end = Math.max(start + 0.1, Math.min(to, buffer.duration));
    if (!(end > start)) end = Math.min(buffer.duration, start + 2);
    try {
      previewCtx = previewCtx ?? new AudioContext();
      void previewCtx.resume();
      const source = previewCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.loopStart = start;
      source.loopEnd = end;
      source.connect(previewCtx.destination);
      source.start(0, start);
      previewNode = source;
      state.preview = { playing: true, from: start, to: end, label };
      source.onended = () => {
        if (previewNode === source) {
          state.preview.playing = false;
          state.preview.label = "";
          previewNode = undefined;
          if (previewRaf) cancelAnimationFrame(previewRaf);
          previewRaf = 0;
        }
      };
      // preview is a monitoring aid only; it never touches the live transport
      return true;
    } catch {
      state.error = "无法试听此区段。";
      return false;
    }
  }

  function auditionBar(barNumber: number) {
    const grid = state.grid;
    if (!grid) return false;
    const i = grid.bars.findIndex((b) => b.index === barNumber);
    if (i < 0) return false;
    const bar = grid.bars[i];
    const before = grid.bars[i - 1]?.time ?? bar.time;
    return audition(
      Math.max(0, before),
      Math.min(grid.duration, barEnd(grid, i)),
      `第 ${barNumber} 小节`,
      true,
    );
  }

  function auditionRun(start: number, end: number, label: string) {
    return audition(
      Math.max(0, start - 0.25),
      Math.min(audio.buffer()?.duration ?? end, end + 0.25),
      label,
      true,
    );
  }

  function auditionCandidate(candidate: Candidate) {
    const first = candidate.bars[0];
    const upto =
      candidate.bars[Math.min(7, candidate.bars.length - 1)] ?? first;
    if (!first) return false;
    return audition(
      first.time,
      Math.min(candidate.duration, upto.time + (upto.time - first.time) / 3 + 0.3),
      candidate.label,
      true,
    );
  }

  // A new song invalidates the previous grid; detection only ever yields
  // candidates and never swaps the live tempo on its own.
  watch(
    () => audio.state.loadedTick,
    () => {
      state.grid = null;
      state.appliedCandidateId = "";
      state.candidates = [];
      state.detected = null;
      state.location = null;
      state.pendingScene = "";
      pendingScene = null;
      state.gridVersion++;
      lastBeatStart = -Infinity;
      void analyse();
    },
  );

  function dispose() {
    cancelAnimationFrame(raf);
    stopPreview();
    clearTimeout(tapTimer);
    clearTimeout(flashTimer);
    void previewCtx?.close();
  }

  return {
    state,
    setEventSink,
    analyse,
    adopt,
    adoptManualGrid,
    clearGrid,
    touchGrid,
    moveDownbeat,
    nudgeDownbeat,
    markUncertain,
    setBeatsPerBar,
    rescale,
    shiftGrid,
    queueScene,
    cancelQueuedScene,
    tap,
    releaseTap,
    audition,
    auditionBar,
    auditionRun,
    auditionCandidate,
    stopPreview,
    reanchor,
    locate: (time: number) =>
      state.grid ? locate(state.grid, time) : null,
    dispose,
  };
}
export type BeatEngine = ReturnType<typeof createBeat>;
