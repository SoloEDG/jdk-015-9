export interface Waveform {
  /** interleaved min/max pairs in -1..1 per x bucket */
  points: Float32Array;
  buckets: number;
  duration: number;
}

export function buildWaveform(
  buffer: {
    duration: number;
    sampleRate: number;
    numberOfChannels: number;
    getChannelData(c: number): Float32Array;
  },
  buckets = 1400,
): Waveform {
  const points = new Float32Array(buckets * 2);
  const length = buffer.getChannelData(0).length;
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels || 1));
  const data = buffer.getChannelData(0);
  const second = channels > 1 ? buffer.getChannelData(1) : undefined;
  const step = Math.max(1, Math.floor(length / buckets));
  for (let b = 0; b < buckets; b++) {
    const from = b * step;
    const to = Math.min(length, from + step);
    let min = 0,
      max = 0;
    for (let i = from; i < to; i += 4) {
      const v = second ? (data[i] + second[i]) / 2 : data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    points[b * 2] = min;
    points[b * 2 + 1] = max;
  }
  return { points, buckets, duration: buffer.duration };
}
