import type { BeatGrid, GridBar } from "./grid";
import { refreshBpm, reindex } from "./grid";

export interface AudioLike {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface Candidate extends BeatGrid {
  label: string;
  notes: string;
  score: number;
  /** musical beats per bar implied by this interpretation */
  downbeatPhase: number;
  stride: number;
  /** offset where this candidate's downbeats are best supported */
  support: number;
}

const HOP = 128;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

interface Envelope {
  rate: number;
  onset: Float32Array;
  low: Float32Array;
}

/** Multi-band energy onset envelope, computed at ~86 frames/second. */
function envelope(audio: AudioLike): Envelope {
  const srcRate = audio.sampleRate || 44100;
  // energy is accumulated every HOP samples of the full-rate mono signal, so
  // the envelope frame rate is samples-per-second divided by the hop
  const rate = srcRate / HOP;
  const mono = new Float32Array(Math.floor(audio.duration * srcRate));
  const channels = Math.max(1, Math.min(2, audio.numberOfChannels || 1));
  for (let ch = 0; ch < channels; ch++) {
    const data = audio.getChannelData(ch);
    const n = Math.min(mono.length, data.length);
    for (let i = 0; i < n; i++) mono[i] += data[i] / channels;
  }
  const frames = Math.max(1, Math.floor(mono.length / HOP));
  const lowE = new Float32Array(frames);
  const midE = new Float32Array(frames);
  const highE = new Float32Array(frames);
  const aLow = 1 - Math.exp((-2 * Math.PI * 150) / srcRate);
  const aMid = 1 - Math.exp((-2 * Math.PI * 1200) / srcRate);
  let low = 0,
    midLP = 0,
    frame = 0,
    accLow = 0,
    accMid = 0,
    accHigh = 0,
    count = 0;
  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    low += aLow * (x - low);
    midLP += aMid * (x - midLP);
    const mid = midLP - low;
    const high = x - midLP;
    accLow += low * low;
    accMid += mid * mid;
    accHigh += high * high;
    count++;
    if (count === HOP) {
      lowE[frame] = accLow / count;
      midE[frame] = accMid / count;
      highE[frame] = accHigh / count;
      accLow = accMid = accHigh = 0;
      count = 0;
      frame++;
    }
  }
  const eps = 1e-9;
  const raw = new Float32Array(frames);
  const bands = [lowE, midE, highE];
  const weights = [1, 0.8, 0.5];
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    for (let b = 0; b < 3; b++) {
      const e = bands[b];
      const d = Math.log(e[f] + eps) - Math.log(e[f - 1] + eps);
      if (d > 0) sum += d * weights[b];
    }
    raw[f] = sum;
  }
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const scale = Math.max(1e-6, p95 - median);
  const onset = new Float32Array(frames);
  for (let f = 0; f < frames; f++)
    onset[f] = clamp((raw[f] - median) / scale, 0, 3);
  const lowSorted = Array.from(lowE).sort((a, b) => a - b);
  const lowRef = Math.max(1e-12, lowSorted[Math.floor(lowSorted.length * 0.9)]);
  const lowBand = new Float32Array(frames);
  for (let f = 0; f < frames; f++)
    lowBand[f] = clamp(
      Math.log1p((lowE[f] / lowRef) * 40) / Math.log(41),
      0,
      1,
    );
  return { rate, onset, low: lowBand };
}

interface AcfPeak {
  lag: number;
  score: number;
}

/** Mean-removed normalised autocorrelation peaks within a frame range. */
function acfPeaks(
  onset: Float32Array,
  rate: number,
  from = 0,
  to = onset.length,
): AcfPeak[] {
  const span = Math.max(1, to - from);
  if (span < rate * 2) return [];
  const minLag = Math.max(2, Math.floor((60 * rate) / 210));
  const maxLag = Math.min(span - 2, Math.ceil((60 * rate) / 50));
  if (maxLag <= minLag) return [];
  let mean = 0;
  for (let i = from; i < to; i++) mean += onset[i];
  mean /= span;
  const acf = new Float32Array(maxLag + 2);
  for (let lag = Math.max(1, minLag - 4); lag <= maxLag + 1; lag++) {
    let sum = 0,
      energy = 0;
    for (let i = from + lag; i < to; i++) {
      const a = onset[i] - mean;
      sum += a * (onset[i - lag] - mean);
      energy += a * a;
    }
    acf[lag] = energy > 1e-9 ? sum / energy : 0;
  }
  const peaks: AcfPeak[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] <= acf[lag - 1] || acf[lag] < acf[lag + 1]) continue;
    const bpm = (60 * rate) / lag;
    peaks.push({ lag, score: Math.max(0, acf[lag]) * tempoPrior(bpm) });
  }
  peaks.sort((a, b) => b.score - a.score);
  // octave correction: a peak at 2x a strong half-period is not the pulse
  const corrected: AcfPeak[] = [];
  for (const p of peaks) {
    let lag = p.lag;
    for (const divisor of [2, 3, 4] as const) {
      const half = Math.round(p.lag / divisor);
      if (half < minLag) break;
      if (acf[half] >= 0.55 * acf[p.lag] && acf[half] >= 0.05) {
        lag = half;
        break;
      }
    }
    const bpm = (60 * rate) / lag;
    corrected.push({ lag, score: Math.max(0, acf[lag]) * tempoPrior(bpm) });
  }
  corrected.sort((a, b) => b.score - a.score);
  const kept: AcfPeak[] = [];
  for (const p of corrected) {
    if (kept.length >= 4) break;
    if (kept.every((k) => Math.abs(k.lag - p.lag) / p.lag > 0.05))
      kept.push(p);
  }
  return kept;
}

/** Dynamic-programming beat tracker, tolerant of gradual tempo change. */
function trackBeats(onset: Float32Array, period: number) {
  const n = onset.length;
  if (n < 4) return [] as number[];
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const minLag = Math.max(2, Math.round(period * 0.5));
  const maxLag = Math.max(minLag + 1, Math.round(period * 2.1));
  const tightness = 6;
  for (let t = 0; t < n; t++) {
    score[t] = onset[t];
    let best = -Infinity,
      bestLag = -1;
    for (let lag = minLag; lag <= maxLag && t - lag >= 0; lag++) {
      const v = score[t - lag] - tightness * Math.log(lag / period) ** 2;
      if (v > best) {
        best = v;
        bestLag = lag;
      }
    }
    if (bestLag > 0) {
      score[t] += best;
      back[t] = bestLag;
    }
  }
  let end = n - 1,
    bestScore = -Infinity;
  const from = Math.max(0, Math.floor(n - period * 3));
  for (let t = from; t < n; t++) {
    if (score[t] > bestScore) {
      bestScore = score[t];
      end = t;
    }
  }
  const beats: number[] = [];
  let cursor = end,
    guard = 0;
  while (cursor >= 0 && guard++ < n) {
    beats.push(cursor);
    const lag = back[cursor];
    if (lag <= 0) break;
    cursor -= lag;
  }
  return beats.reverse();
}

/**
 * Track beats in overlapping segments so an abrupt tempo change in the middle
 * of the song is followed instead of averaged away.
 */
function trackSegmented(
  onset: Float32Array,
  rate: number,
  clusters: number[],
) {
  const totalSeconds = onset.length / rate;
  const segCount = clamp(Math.round(totalSeconds / 10), 1, 12);
  const segLength = Math.ceil(onset.length / segCount);
  const beats: number[] = [];
  for (let s = 0; s < segCount; s++) {
    const from = Math.max(0, s * segLength - Math.round(rate * 0.5));
    const to = Math.min(
      onset.length,
      (s + 1) * segLength + Math.round(rate * 0.5),
    );
    if (to - from < rate * 2) continue;
    const local = acfPeaks(onset, rate, from, to);
    const period =
      local[0]?.lag ??
      (clusters.length ? clusters[0] : Math.round((60 * rate) / 120));
    if (!period) continue;
    const segBeats = trackBeats(onset.slice(from, to), period).map(
      (b) => b + from,
    );
    for (const b of segBeats) {
      if (!beats.length || b - beats[beats.length - 1] > 3)
        beats.push(b);
    }
  }
  return beats.sort((a, b) => a - b);
}

/** Median beat-to-beat spacing of a tracked sequence, in frames. */
function beatPeriod(beats: number[]) {
  if (beats.length < 2) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 1) deltas.push(d);
  }
  return deltas.length ? median(deltas) : 0;
}

function sample(array: Float32Array, index: number, spread: number) {
  let sum = 0,
    n = 0;
  for (
    let i = Math.max(0, Math.floor(index - spread));
    i <= Math.min(array.length - 1, Math.ceil(index + spread));
    i++
  ) {
    sum += array[i];
    n++;
  }
  return n ? sum / n : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Weak preference for plausible dance tempos; never a hard filter. */
function tempoPrior(bpm: number) {
  if (bpm < 45 || bpm > 210) return 0;
  const centre = Math.log2(118);
  const spread = bpm > 140 || bpm < 90 ? 0.62 : 0.85;
  return Math.exp(-0.5 * ((Math.log2(bpm) - centre) / spread) ** 2);
}

/** Move a DP beat frame onto the local onset peak, within a short window. */
function refineOnset(onset: Float32Array, frame: number, radius = 3) {
  let best = frame,
    bestValue = onset[frame] ?? 0;
  for (
    let i = Math.max(0, frame - radius);
    i <= Math.min(onset.length - 1, frame + radius);
    i++
  ) {
    if (onset[i] > bestValue) {
      best = i;
      bestValue = onset[i];
    }
  }
  return best;
}

function pickDownbeatPhase(
  beats: number[],
  stride: number,
  low: Float32Array,
  onset: Float32Array,
) {
  const options: { phase: number; score: number }[] = [];
  const allLow =
    beats.reduce((s, b) => s + sample(low, b, 1), 0) / Math.max(1, beats.length);
  const allOnset =
    beats.reduce((s, b) => s + sample(onset, b, 1), 0) /
    Math.max(1, beats.length);
  for (let phase = 0; phase < stride && phase < beats.length; phase++) {
    let lowSum = 0,
      onsetSum = 0,
      count = 0;
    for (let i = phase; i < beats.length; i += stride) {
      lowSum += sample(low, beats[i], 1);
      onsetSum += sample(onset, beats[i], 1);
      count++;
    }
    if (!count) continue;
    const score =
      (lowSum / count) / Math.max(0.001, allLow) +
      0.25 * ((onsetSum / count) / Math.max(0.001, allOnset));
    options.push({ phase, score });
  }
  options.sort((a, b) => b.score - a.score);
  return options;
}

/**
 * Snap tracked bars onto a locally steady grid. Detection frames carry a few
 * milliseconds of jitter, and a grid that wobbles 3 BPM bar-to-bar reads as a
 * tempo change that is not there. Each bar is pulled toward its neighbours
 * while staying within the tolerance of the audio onset, and abrupt genuine
 * changes survive because the smoothing window is short.
 */
function straighten(frames: number[], onset: Float32Array) {
  if (frames.length < 3) return frames.slice();
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1]);
  // Local median period over a short window: a genuine tempo change is still
  // followed within a couple of bars, while onset jitter is averaged out.
  const periods = deltas.map((_, i) =>
    median(deltas.slice(Math.max(0, i - 2), Math.min(deltas.length, i + 3))),
  );
  const out = frames.slice();
  for (let i = 1; i < out.length; i++) {
    const period = Math.max(2, periods[i - 1]);
    const expected = out[i - 1] + period;
    // prefer an actual attack near the expected position (hats sit at 1/2 or
    // 1/4 of a beat, well outside this window); otherwise stay on the grid
    const radius = Math.max(2, Math.round(period * 0.16));
    const peak = refineOnset(onset, Math.round(expected), radius);
    const strong =
      (onset[peak] ?? 0) >= 0.35 && Math.abs(peak - expected) <= radius;
    out[i] = strong
      ? peak
      : clamp(expected, frames[i] - radius, frames[i] + radius);
  }
  return out;
}

function buildCandidate(
  beats: number[],
  rate: number,
  stride: number,
  phase: number,
  low: Float32Array,
  onset: Float32Array,
  duration: number,
  label: string,
  tempoNote: string,
): Candidate | null {
  // snap each beat to the strongest nearby onset so grid lines sit on attacks
  const snapped = beats.map((b) => refineOnset(onset, b));
  // Drop the jittery intro: a tracker lock-in may wander for a few beats.
  // Each leading stretch is judged against the beats that follow it, so a
  // genuine mid-song tempo change is never trimmed away.
  const deltas = snapped.slice(1).map((v, i) => v - snapped[i]);
  let head = 0;
  while (head < deltas.length - 5) {
    const early = median(deltas.slice(head, head + 2));
    const later = median(deltas.slice(head + 2, head + 7));
    if (!early || !later) break;
    const ratio = early / later;
    if (ratio > 0.88 && ratio < 1.12) break;
    head++;
  }
  let trimmed = snapped.slice(head);
  // extend the pulse to both song edges so bars cover the whole timeline
  const truePeriod = beatPeriod(trimmed);
  if (truePeriod > 0) {
    const first = trimmed[0];
    const lead: number[] = [];
    for (let t = first - truePeriod; t >= 0; t -= truePeriod)
      lead.unshift(refineOnset(onset, t));
    trimmed = [...lead, ...trimmed];
    const last = trimmed[trimmed.length - 1];
    const frames = onset.length;
    const tail: number[] = [];
    for (let t = last + truePeriod; t < frames - 1; t += truePeriod)
      tail.push(refineOnset(onset, t));
    trimmed = [...trimmed, ...tail];
  }
  trimmed = straighten(trimmed, onset);
  const barStarts: number[] = [];
  for (let i = phase; i < trimmed.length; i += stride)
    barStarts.push(trimmed[i]);
  if (barStarts.length < 2) return null;
  const lowAt = barStarts.map((b) => sample(low, b, 2));
  const onsetAt = barStarts.map((b) => sample(onset, b, 2));
  const lowRef = Math.max(0.02, median(lowAt));
  const onsetRef = Math.max(0.02, median(onsetAt));
  const intervals: number[] = [];
  for (let i = 1; i < barStarts.length; i++)
    intervals.push((barStarts[i] - barStarts[i - 1]) / rate);
  const intervalRef = Math.max(0.05, median(intervals));
  // Compare each bar interval with its local neighbours so a deliberate
  // tempo change is not mistaken for sloppy detection; only abrupt jumps and
  // weak attacks make a bar uncertain.
  const neighbourhood = (i: number) => {
    const values: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(intervals.length - 1, i + 2); k++)
      values.push(intervals[k]);
    return Math.max(0.03, median(values));
  };
  const bars: GridBar[] = barStarts.map((frame, i) => {
    const lowScore = clamp(lowAt[i] / lowRef, 0, 1.15);
    const onsetScore = clamp(onsetAt[i] / onsetRef, 0, 1.15);
    const local = intervals[i] ?? intervals[i - 1] ?? intervalRef;
    const near = neighbourhood(i);
    const jump = Math.abs(Math.log(Math.max(0.03, local) / near));
    const regular = clamp(1 - jump * 6, 0, 1);
    const steady = clamp(1 - jump * 3.5, 0, 1);
    const attack = Math.max(lowScore, onsetScore);
    const confidence = clamp(
      (0.6 * attack + 0.22 * lowScore + 0.18 * steady) * regular,
      0,
      1,
    );
    return {
      index: i + 1,
      time: Math.round((frame / rate) * 1000) / 1000,
      confidence,
      uncertain: confidence < 0.5 || attack < 0.6 || jump > 0.14,
      source: "detected",
    };
  });
  while (bars.length > 2 && duration - bars[bars.length - 1].time < 0.15)
    bars.pop();
  reindex(bars);
  const grid: BeatGrid = {
    id: `grid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    bpm: 120,
    beatsPerBar: 4,
    bars,
    duration,
    sourceName: label,
    createdAt: Date.now(),
  };
  refreshBpm(grid);
  const avgConfidence =
    bars.reduce((s, b) => s + b.confidence, 0) / bars.length;
  const uncertainRatio = bars.filter((b) => b.uncertain).length / bars.length;
  const coverage = (bars.length * intervalRef) / Math.max(0.1, duration);
  const musicalBars = bars.filter((b) => {
    const bd = intervalRef;
    return bd > 0.7 && bd < 6;
  }).length;
  const musical = musicalBars / Math.max(1, bars.length);
  // beats of this interpretation should land on onsets
  const beatDur = intervalRef / Math.max(1, grid.beatsPerBar);
  let alignSum = 0,
    alignCount = 0;
  for (let i = 0; i < bars.length; i++) {
    const end = bars[i + 1]?.time ?? duration;
    for (let t = bars[i].time; t < end - 0.02; t += beatDur) {
      alignSum += sample(onset, (t / rate) | 0, 2);
      alignCount++;
    }
  }
  const alignment = alignCount ? alignSum / alignCount : 0;
  // How much stronger are the chosen downbeats than the other beats?
  // A bar with its accents on 1 and 3 beats a doubled bar that splits them.
  let accentDown = 0,
    accentAll = 0,
    accentCount = 0;
  for (let i = phase; i < snapped.length; i++) {
    const v = sample(low, snapped[i], 2) + 0.4 * sample(onset, snapped[i], 2);
    accentAll += v;
    accentCount++;
    if ((i - phase) % stride === 0) accentDown += v;
  }
  const downbeats = Math.max(1, Math.ceil(accentCount / stride));
  const accentContrast = clamp(
    accentAll > 1e-6
      ? accentDown / downbeats / (accentAll / Math.max(1, accentCount))
      : 1,
    0,
    1.6,
  );
  // A bar longer than ~5s or shorter than ~0.8s is rarely the real metre.
  const barPrior = Math.exp(
    -0.5 * (Math.log(Math.max(0.2, intervalRef) / 2.1) / 0.42) ** 2,
  );
  const score =
    avgConfidence * 0.28 +
    alignment * 0.26 +
    (accentContrast / 1.6) * 0.14 +
    Math.min(1, coverage) * 0.12 +
    musical * 0.06 +
    barPrior * 0.1;
  return {
    ...grid,
    label,
    score,
    stride,
    downbeatPhase: phase,
    support: alignment,
    notes: `${bars.length} 小节 · ${bars.filter((b) => b.uncertain).length} 小节待确认${tempoNote}`,
  };
}

export interface DetectResult {
  candidates: Candidate[];
  bpmPeaks: number[];
  tempoChange: boolean;
  duration: number;
}

export function detectCandidates(audio: AudioLike): DetectResult {
  const env = envelope(audio);
  const total = env.onset.length;
  const global = acfPeaks(env.onset, env.rate);
  const segments = clamp(Math.round(audio.duration / 8), 2, 8);
  const segmentPeaks = Array.from({ length: segments }, (_, s) =>
    acfPeaks(
      env.onset,
      env.rate,
      Math.floor((s * total) / segments),
      Math.floor(((s + 1) * total) / segments),
    ),
  );

  // Pool lags across segments; the winner plus its rivals become tempo inputs.
  type Cluster = { lag: number; score: number; count: number };
  const clusters: Cluster[] = [];
  for (const peaks of [global, ...segmentPeaks]) {
    for (const p of peaks.slice(0, 3)) {
      const found = clusters.find(
        (c) => Math.abs(c.lag - p.lag) / p.lag < 0.035,
      );
      if (found) {
        found.lag = (found.lag * found.count + p.lag) / (found.count + 1);
        found.score += p.score;
        found.count++;
      } else clusters.push({ lag: p.lag, score: p.score, count: 1 });
    }
  }
  clusters.sort((a, b) => b.count * 2 + b.score - (a.count * 2 + a.score));
  // if two clusters are a near 2:1 pair, keep the one the segments agree on
  if (clusters.length > 1) {
    const [a, b] = clusters;
    const ratio = a.lag > b.lag ? a.lag / b.lag : b.lag / a.lag;
    if (Math.abs(ratio - 2) < 0.08 && a.count !== b.count) {
      clusters.sort((x, y) => y.count - x.count || y.score - x.score);
    }
  }
  const tempoLags = clusters
    .slice(0, 2)
    .map((c) => Math.round(c.lag))
    .filter((v, i, a) => a.indexOf(v) === i);
  const primaryLag = tempoLags[0] ?? global[0]?.lag ?? Math.round((60 * env.rate) / 120);

  // Tempo change: compare the strongest lag of the opening and closing turths.
  const thirds = segmentPeaks
    .map((p) => p[0]?.lag)
    .filter((v): v is number => !!v);
  let tempoChange = false;
  if (thirds.length >= 2) {
    const head = median(thirds.slice(0, Math.ceil(thirds.length / 3)));
    const tail = median(thirds.slice(-Math.ceil(thirds.length / 3)));
    tempoChange = head > 0 && tail > 0 && Math.abs(Math.log(tail / head)) > 0.04;
  }
  const tempoNote = tempoChange ? " · 检测到中途变速" : "";

  const beatSets: { beats: number[]; lag: number; fromSegment: boolean }[] = [];
  const globalBeats = trackBeats(env.onset, primaryLag);
  if (globalBeats.length >= 6)
    beatSets.push({ beats: globalBeats, lag: primaryLag, fromSegment: false });
  if (tempoChange) {
    const segBeats = trackSegmented(env.onset, env.rate, [primaryLag]);
    if (segBeats.length >= 6)
      beatSets.push({ beats: segBeats, lag: primaryLag, fromSegment: true });
  }
  for (const lag of tempoLags.slice(1)) {
    const beats = trackBeats(env.onset, lag);
    if (beats.length >= 6)
      beatSets.push({ beats, lag, fromSegment: false });
  }

  const interpretations = [
    { stride: 4, label: "标准速度" },
    { stride: 8, label: "半速（两拍当一拍）" },
    { stride: 2, label: "双速（一拍分两下）" },
  ];
  const candidates: Candidate[] = [];
  for (let set = 0; set < Math.min(2, beatSets.length); set++) {
    const { beats } = beatSets[set];
    const sourceNote = beatSets[set].fromSegment ? " · 分段追随" : "";
    for (const interp of interpretations) {
      const phases = pickDownbeatPhase(beats, interp.stride, env.low, env.onset);
      const phaseCount = interp.stride === 4 ? 2 : 1;
      for (let p = 0; p < Math.min(phaseCount, phases.length); p++) {
        const phase = phases[p].phase;
        const label =
          interp.label +
          (p === 1 ? " · 相位 B" : "") +
          (set === 1 ? " · 备选速度" : "");
        const candidate = buildCandidate(
          beats,
          env.rate,
          interp.stride,
          phase,
          env.low,
          env.onset,
          audio.duration,
          label,
          tempoNote + sourceNote,
        );
        if (candidate) candidates.push(candidate);
      }
    }
  }
  // De-duplicate near-identical interpretations, keeping the strongest.
  const deduped: Candidate[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (
      deduped.some(
        (d) =>
          d.bars.length === c.bars.length &&
          Math.abs(d.bars[0]?.time - c.bars[0]?.time) < 0.02 &&
          Math.abs(d.bpm - c.bpm) < 1,
      )
    )
      continue;
    deduped.push(c);
  }
  return {
    candidates: deduped.slice(0, 8),
    bpmPeaks: clusters
      .slice(0, 3)
      .map((c) => Math.round((60 * env.rate) / c.lag)),
    tempoChange,
    duration: audio.duration,
  };
}
