export interface GridBar {
  /** musical bar number, 1-based, absolute for the whole song */
  index: number;
  /** time of this bar's downbeat, in seconds */
  time: number;
  /** 0..1 estimate of how reliable this downbeat is */
  confidence: number;
  /** low-confidence stretch — kept, never silently dropped */
  uncertain: boolean;
  source: "detected" | "edited";
}

export interface BeatGrid {
  id: string;
  bpm: number;
  beatsPerBar: number;
  bars: GridBar[];
  duration: number;
  sourceName: string;
  createdAt: number;
}

export interface BeatLocation {
  barNumber: number;
  beatNumber: number;
  phase: number;
  beatStart: number;
  nextBeat: number;
  nextBar: number;
  barTime: number;
  beatDuration: number;
  bpm: number;
  uncertain: boolean;
  beforeStart: boolean;
}

export interface GridRun {
  from: number;
  to: number;
  start: number;
  end: number;
}

export const barEnd = (grid: BeatGrid, i: number) =>
  grid.bars[i + 1]?.time ?? grid.duration;

const barDuration = (grid: BeatGrid, i: number) =>
  Math.max(0.02, barEnd(grid, i) - grid.bars[i]?.time);

export const beatDuration = (grid: BeatGrid, i: number) =>
  barDuration(grid, i) / Math.max(1, grid.beatsPerBar);

export function locate(grid: BeatGrid, time: number): BeatLocation {
  const bars = grid.bars;
  const first = bars[0];
  if (!first) {
    return {
      barNumber: 1,
      beatNumber: 0,
      phase: 0,
      beatStart: 0,
      nextBeat: 0.5,
      nextBar: 0.5,
      barTime: 0,
      beatDuration: 0.5,
      bpm: grid.bpm || 120,
      uncertain: false,
      beforeStart: false,
    };
  }
  if (time < first.time) {
    const bd = beatDuration(grid, 0);
    return {
      barNumber: first.index,
      beatNumber: 0,
      phase: Math.max(0, 1 - (first.time - time) / bd),
      beatStart: first.time,
      nextBeat: first.time,
      nextBar: first.time,
      barTime: first.time,
      beatDuration: bd,
      bpm: 60 / bd,
      uncertain: first.uncertain,
      beforeStart: true,
    };
  }
  let lo = 0,
    hi = bars.length - 1,
    i = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const bar = bars[i];
  const bd = beatDuration(grid, i);
  let raw = Math.floor((time - bar.time) / bd);
  if (raw < 0) raw = 0;
  const barOffset = Math.floor(raw / grid.beatsPerBar);
  const beatNumber = raw - barOffset * grid.beatsPerBar;
  const beatStart = bar.time + raw * bd;
  const nextBar = barEnd(grid, i);
  return {
    barNumber: bar.index + barOffset,
    beatNumber,
    phase: Math.min(1, Math.max(0, (time - beatStart) / bd)),
    beatStart,
    nextBeat: beatStart + bd,
    nextBar: nextBar,
    barTime: bar.time + barOffset * bd * grid.beatsPerBar,
    beatDuration: bd,
    bpm: 60 / bd,
    uncertain: bar.uncertain,
    beforeStart: false,
  };
}


/** Index of the bar containing `time` (clamped to the first bar). */
export function barAt(grid: BeatGrid, time: number) {
  const bars = grid.bars;
  if (!bars.length) return 0;
  if (time < bars[0].time) return 0;
  let lo = 0,
    hi = bars.length - 1,
    i = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return i;
}

export function nearestBar(grid: BeatGrid, time: number) {
  if (!grid.bars.length) return 0;
  const i = barAt(grid, time);
  if (i + 1 < grid.bars.length) {
    const d0 = Math.abs(time - grid.bars[i].time);
    const d1 = Math.abs(time - grid.bars[i + 1].time);
    if (d1 < d0) return i + 1;
  }
  return i;
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Move one downbeat; neighbouring bar spacing follows automatically. */
export function moveBar(grid: BeatGrid, barNumber: number, time: number) {
  const i = grid.bars.findIndex((b) => b.index === barNumber);
  if (i < 0) return false;
  const previous = grid.bars[i - 1];
  const next = grid.bars[i + 1];
  const minGap = 0.06;
  const lo = previous ? previous.time + minGap : 0;
  const hi = next ? next.time - minGap : Math.max(lo, grid.duration - 0.03);
  const t = clamp(time, lo, hi);
  const bar = grid.bars[i];
  if (Math.abs(t - bar.time) < 0.002) return false;
  bar.time = t;
  bar.source = "edited";
  bar.confidence = 1;
  bar.uncertain = false;
  refreshBpm(grid);
  return true;
}

export function shiftBar(grid: BeatGrid, barNumber: number, delta: number) {
  const bar = grid.bars.find((b) => b.index === barNumber);
  if (!bar) return false;
  return moveBar(grid, barNumber, bar.time + delta);
}

export function setUncertain(
  grid: BeatGrid,
  barNumber: number,
  uncertain: boolean,
) {
  const bar = grid.bars.find((b) => b.index === barNumber);
  if (!bar) return false;
  bar.uncertain = uncertain;
  if (uncertain) bar.confidence = Math.min(bar.confidence, 0.4);
  else bar.confidence = Math.max(bar.confidence, 0.7);
  return true;
}

export function uncertainRuns(grid: BeatGrid): GridRun[] {
  const runs: GridRun[] = [];
  let open: GridRun | null = null;
  grid.bars.forEach((bar, i) => {
    if (bar.uncertain) {
      if (!open) open = { from: bar.index, to: bar.index, start: bar.time, end: barEnd(grid, i) };
      else {
        open.to = bar.index;
        open.end = barEnd(grid, i);
      }
    } else if (open) {
      runs.push(open);
      open = null;
    }
  });
  if (open) runs.push(open);
  return runs;
}



export function refreshBpm(grid: BeatGrid) {
  const durations: number[] = [];
  for (let i = 0; i < grid.bars.length; i++) {
    const bd = beatDuration(grid, i);
    if (Number.isFinite(bd) && bd > 0.05) durations.push(bd);
  }
  durations.sort((a, b) => a - b);
  if (durations.length)
    grid.bpm = Math.round(60 / durations[Math.floor(durations.length / 2)]);
}

export function reindex(bars: GridBar[]) {
  bars.forEach((b, i) => (b.index = i + 1));
  return bars;
}

/** factor 2 = fewer, longer bars (half-time feel); 0.5 = twice as many. */
export function rescaleGrid(grid: BeatGrid, factor: 2 | 0.5): BeatGrid {
  let bars: GridBar[];
  if (factor === 2) {
    bars = grid.bars
      .filter((_, i) => i % 2 === 0)
      .map((b) => ({ ...b, source: "edited" as const }));
  } else {
    bars = [];
    grid.bars.forEach((bar, i) => {
      const end = barEnd(grid, i);
      bars.push({ ...bar, source: "edited" });
      if (end - bar.time > 0.12)
        bars.push({
          index: 0,
          time: (bar.time + end) / 2,
          confidence: bar.confidence * 0.8,
          uncertain: bar.uncertain,
          source: "edited",
        });
    });
  }
  const next: BeatGrid = {
    ...grid,
    id: `grid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    // merging bars halves the tempo; splitting doubles it
    bpm: Math.round(grid.bpm / factor),
    bars: reindex(bars),
  };
  refreshBpm(next);
  return next;
}


export function gridSummary(grid: BeatGrid) {
  const uncertainBars = grid.bars.filter((b) => b.uncertain).length;
  const editedBars = grid.bars.filter((b) => b.source === "edited").length;
  return { bars: grid.bars.length, uncertainBars, editedBars };
}

/**
 * Tempo for display: median of this bar and its neighbours. A single snapped
 * bar can be a few BPM off, but the readout should not flicker. Genuine tempo
 * changes still come through after one bar.
 */
export function stableBpm(grid: BeatGrid, barIndex: number) {
  const i = grid.bars.findIndex((b) => b.index === barIndex);
  if (i < 0) return grid.bpm;
  const values: number[] = [];
  // the final bar is usually cut off by the end of the song, so its own
  // interval would read as a huge tempo and must not set the display
  const lastFull = grid.bars.length - 1;
  for (let k = Math.max(0, i - 1); k <= Math.min(lastFull, i + 1); k++)
    values.push(60 / beatDuration(grid, Math.min(k, Math.max(0, lastFull - 1))));
  values.sort((a, b) => a - b);
  return Math.round(values[Math.floor(values.length / 2)]);
}
