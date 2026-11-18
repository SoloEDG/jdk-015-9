<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { AudioEngine } from "../../audio/model/engine";
import type { BeatEngine } from "../model/beat";
import type { Waveform } from "../lib/waveform";
import { barEnd, locate, nearestBar } from "../lib/grid";
import { clock } from "../../../shared/math";

const props = defineProps<{
  beat: BeatEngine;
  audio: AudioEngine;
  waveform: Waveform | null;
  selectedBar: number;
}>();
const emit = defineEmits<{ select: [number] }>();
const canvas = ref<HTMLCanvasElement>();

const RULER = 22;
const STRIP = 24;
const MIN_H = 178;
let base: HTMLCanvasElement | null = null;
let raf = 0;
let ro: ResizeObserver | undefined;
let W = 0,
  H = 0,
  dpr = 1;
let baseDirty = true;
let drag:
  | { kind: "bar"; bar: number }
  | { kind: "loop"; edge: "start" | "end" }
  | { kind: "seek"; time: number; moved: boolean }
  | null = null;
let hoverBar = 0;

const snapTime = (time: number) => {
  const grid = props.beat.state.grid;
  if (!grid) return time;
  const loc = locate(grid, time);
  const candidates = [loc.beatStart, loc.nextBeat];
  let best = candidates[0],
    bestDist = Math.abs(time - best);
  for (const c of candidates) {
    const d = Math.abs(time - c);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  // within 180ms of a beat, snap; otherwise keep the free position
  return Math.abs(time - best) < 0.18 ? best : time;
};

function geometry() {
  const el = canvas.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(280, Math.round(rect.width));
  H = Math.max(MIN_H, Math.round(rect.height));
  if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
    el.width = Math.round(W * dpr);
    el.height = Math.round(H * dpr);
  }
}

function paintBase() {
  const el = canvas.value;
  const grid = props.beat.state.grid;
  if (!el) return;
  geometry();
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.fillStyle = "#0d0e15";
  g.fillRect(0, 0, W, H);
  const top = RULER,
    bottom = H - STRIP,
    mid = (top + bottom) / 2,
    half = (bottom - top) / 2 - 6;
  const duration = Math.max(
    0.1,
    props.waveform?.duration ?? props.audio.state.duration ?? 1,
  );
  const x = (t: number) => (t / duration) * W;
  const tAt = (px: number) => Math.max(0, Math.min(1, px / W)) * duration;

  // loop region
  const loop = props.audio.state.loop;
  if (loop.enabled) {
    const x0 = x(loop.start),
      x1 = x(loop.end);
    g.fillStyle = "#8f7cd415";
    g.fillRect(x0, top, x1 - x0, bottom - top);
    g.strokeStyle = "#a18ce055";
    g.strokeRect(x0 + 0.5, top + 0.5, Math.max(1, x1 - x0 - 1), bottom - top - 1);
  }

  // waveform
  if (props.waveform) {
    const pts = props.waveform.points;
    const buckets = props.waveform.buckets;
    g.strokeStyle = "#5d5c72";
    g.lineWidth = 1;
    g.beginPath();
    const step = Math.max(1, Math.floor(buckets / W));
    for (let b = 0; b < buckets; b += step) {
      const px = (b / buckets) * W;
      const lo = pts[b * 2],
        hi = pts[b * 2 + 1];
      g.moveTo(px, mid - hi * half);
      g.lineTo(px, mid - lo * half + 0.5);
    }
    g.stroke();
  } else {
    g.fillStyle = "#3b3a49";
    g.font = '10px "DM Sans", sans-serif';
    g.fillText("载入音频后可查看波形", 12, mid);
  }

  if (!grid) {
    g.strokeStyle = "#34313f";
    g.beginPath();
    g.moveTo(0, bottom + 0.5);
    g.lineTo(W, bottom + 0.5);
    g.stroke();
    base = c;
    return;
  }

  const selected = props.selectedBar;
  const beatsPerBar = Math.max(1, grid.beatsPerBar);
  const labelStep = Math.max(
    1,
    Math.ceil(grid.bars.length / Math.max(4, Math.floor(W / 78))),
  );

  grid.bars.forEach((bar, i) => {
    const end = barEnd(grid, i);
    const bx = x(bar.time);
    const ex = x(end);
    if (bar.index === selected) {
      g.fillStyle = "#b4a1f50f";
      g.fillRect(bx, top, Math.max(2, ex - bx), bottom - top);
    }
    // beat ticks
    const bd = (end - bar.time) / beatsPerBar;
    g.strokeStyle = bar.uncertain ? "#c9a15c66" : "#7a6ba066";
    g.lineWidth = 1;
    for (let b = 1; b < beatsPerBar; b++) {
      const px = Math.round(x(bar.time + b * bd)) + 0.5;
      g.beginPath();
      g.moveTo(px, bottom - 9);
      g.lineTo(px, bottom);
      g.stroke();
    }
    // downbeat line
    g.strokeStyle = bar.uncertain ? "#d9a94e" : "#b4a1f5cc";
    g.lineWidth = bar.index === selected ? 2 : 1.2;
    if (bar.uncertain) g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(Math.round(bx) + 0.5, top);
    g.lineTo(Math.round(bx) + 0.5, bottom);
    g.stroke();
    g.setLineDash([]);
    // downbeat number
    if (bar.index === 1 || bar.index % labelStep === 0 || bar.index === selected) {
      g.fillStyle =
        bar.index === selected
          ? "#e3d9fa"
          : bar.uncertain
            ? "#c9a15c"
            : "#89809f";
      g.font = '9px "Space Grotesk", sans-serif';
      g.fillText(String(bar.index), bx + 3, bottom + 13);
    }
    if (bar.uncertain) {
      g.fillStyle = "#c9a15c22";
      g.fillRect(bx, bottom + 2, Math.max(2, ex - bx), STRIP - 4);
    }
  });

  // selected downbeat handle
  const sel = grid.bars.find((b) => b.index === selected);
  if (sel) {
    const px = x(sel.time);
    g.fillStyle = "#e7dcff";
    g.beginPath();
    g.moveTo(px - 4, top);
    g.lineTo(px + 4, top);
    g.lineTo(px, top + 6);
    g.closePath();
    g.fill();
  }
  if (hoverBar) {
    const bar = grid.bars.find((b) => b.index === hoverBar);
    if (bar && bar.index !== selected) {
      g.strokeStyle = "#cdbff033";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(x(bar.time)) + 0.5, top);
      g.lineTo(Math.round(x(bar.time)) + 0.5, bottom);
      g.stroke();
    }
  }

  // ruler ticks
  const span = duration;
  const step = span > 240 ? 30 : span > 120 ? 15 : span > 60 ? 10 : 5;
  g.strokeStyle = "#262530";
  g.fillStyle = "#5c5a6e";
  g.font = '8px "Space Grotesk", sans-serif';
  for (let t = 0; t <= span; t += step) {
    const px = Math.round(x(t)) + 0.5;
    g.beginPath();
    g.moveTo(px, top - 6);
    g.lineTo(px, top);
    g.stroke();
    g.fillText(clock(t), px + 3, 10);
  }
  g.strokeStyle = "#2a2935";
  g.beginPath();
  g.moveTo(0, top + 0.5);
  g.lineTo(W, top + 0.5);
  g.moveTo(0, bottom + 0.5);
  g.lineTo(W, bottom + 0.5);
  g.stroke();

  // loop handles in ruler
  if (loop.enabled) {
    for (const edge of ["start", "end"] as const) {
      const px = x(edge === "start" ? loop.start : loop.end);
      g.fillStyle = "#b09ae8";
      g.beginPath();
      if (edge === "start") {
        g.moveTo(px, RULER);
        g.lineTo(px + 7, RULER);
        g.lineTo(px, RULER - 8);
      } else {
        g.moveTo(px, RULER);
        g.lineTo(px - 7, RULER);
        g.lineTo(px, RULER - 8);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = "#b09ae8";
      g.beginPath();
      g.moveTo(px + 0.5, RULER);
      g.lineTo(px + 0.5, bottom);
      g.stroke();
    }
  }
  base = c;
  baseDirty = false;
}

function paint() {
  const el = canvas.value;
  if (!el) return;
  if (baseDirty || !base) paintBase();
  const g = el.getContext("2d")!;
  geometry();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (base) g.drawImage(base, 0, 0, W, H);
  const grid = props.beat.state.grid;
  const duration = Math.max(
    0.1,
    props.waveform?.duration ?? props.audio.state.duration ?? 1,
  );
  if (grid) {
    const pos = props.audio.state.position;
    const px = Math.max(0, Math.min(W, (pos / duration) * W));
    g.fillStyle = "#ffffff22";
    g.fillRect(px - 1, RULER, 3, H - RULER - STRIP);
    g.fillStyle = "#f3ecff";
    g.fillRect(px - 0.6, RULER, 1.4, H - RULER - STRIP);
    const loc = props.beat.state.location;
    if (loc) {
      g.fillStyle = "#b9a9e8";
      g.font = '9px "Space Grotesk", sans-serif';
      const label = `${loc.barNumber}.${loc.beatNumber + 1}`;
      const lw = g.measureText(label).width;
      g.fillText(label, Math.min(W - lw - 4, px + 5), RULER + 12);
    }
  }
  raf = requestAnimationFrame(paint);
}

function pointAt(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    time:
      (Math.max(0, Math.min(rect.width, e.clientX - rect.left)) /
        Math.max(1, rect.width)) *
      Math.max(0.1, props.audio.state.duration || 1),
  };
}

function nearBar(px: number) {
  const grid = props.beat.state.grid;
  if (!grid) return 0;
  const duration = Math.max(0.1, props.audio.state.duration || 1);
  let best = 0,
    bestDist = 8;
  for (const bar of grid.bars) {
    const bx = (bar.time / duration) * W;
    const d = Math.abs(bx - px);
    if (d < bestDist) {
      best = bar.index;
      bestDist = d;
    }
  }
  return best;
}

function onDown(e: PointerEvent) {
  const el = canvas.value;
  if (!el) return;
  const grid = props.beat.state.grid;
  const { x, y, time } = pointAt(e);
  el.setPointerCapture(e.pointerId);
  if (!grid) {
    drag = { kind: "seek", time, moved: false };
    return;
  }
  const duration = Math.max(0.1, props.audio.state.duration || 1);
  const loop = props.audio.state.loop;
  if (y < RULER + 6 && loop.enabled) {
    const xs = (loop.start / duration) * W,
      xe = (loop.end / duration) * W;
    if (Math.abs(x - xs) <= 9) {
      drag = { kind: "loop", edge: "start" };
      return;
    }
    if (Math.abs(x - xe) <= 9) {
      drag = { kind: "loop", edge: "end" };
      return;
    }
  }
  const bar = nearBar(x);
  if (bar) {
    drag = { kind: "bar", bar };
    emit("select", bar);
    return;
  }
  drag = { kind: "seek", time, moved: false };
}

function onMove(e: PointerEvent) {
  const { x, time } = pointAt(e);
  const grid = props.beat.state.grid;
  if (!drag) {
    const bar = nearBar(x);
    if (bar !== hoverBar) {
      hoverBar = bar;
      baseDirty = true;
      canvas.value?.style.setProperty("cursor", bar ? "ew-resize" : "pointer");
    }
    return;
  }
  if (drag.kind === "bar") {
    props.beat.moveDownbeat(drag.bar, time);
    baseDirty = true;
  } else if (drag.kind === "loop") {
    const duration = Math.max(0.1, props.audio.state.duration || 1);
    const t = snapTime(Math.max(0, Math.min(duration, time)));
    props.audio.setLoopEdge(drag.edge, t);
    if (grid) emit("select", nearestBar(grid, t) + 1);
    baseDirty = true;
  } else if (drag.kind === "seek") {
    if (Math.abs(time - drag.time) > 0.02) drag.moved = true;
  }
}

function onUp(e: PointerEvent) {
  const el = canvas.value;
  if (!el) return;
  try {
    el.releasePointerCapture(e.pointerId);
  } catch {}
  if (drag?.kind === "seek") {
    const { time } = pointAt(e);
    props.audio.seek(time);
    const grid = props.beat.state.grid;
    if (grid) emit("select", nearestBar(grid, time) + 1);
    props.beat.reanchor(time);
  }  drag = null;
  baseDirty = true;
}

function onLeave() {
  if (!drag && hoverBar) {
    hoverBar = 0;
    baseDirty = true;
  }
}

onMounted(() => {
  const el = canvas.value!;
  geometry();
  el.height = H * dpr;
  ro = new ResizeObserver(() => {
    baseDirty = true;
  });
  ro.observe(el);
  raf = requestAnimationFrame(paint);
});
onUnmounted(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
});
watch(
  () => [
    props.waveform,
    props.beat.state.gridVersion,
    props.selectedBar,
    props.audio.state.loop.enabled,
    props.audio.state.loop.start,
    props.audio.state.loop.end,
  ],
  () => (baseDirty = true),
  { deep: true },
);
</script>
<template>
  <canvas
    ref="canvas"
    class="beat-grid-canvas"
    aria-label="节拍网格编辑器"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  />
</template>
