import type { Analysis } from "../../../shared/types";
export function analyse(
  freq: Uint8Array,
  wave: Uint8Array,
  time: number,
  sensitivity: number,
  previous: number,
): Analysis {
  const rms = Math.sqrt(
    wave.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / wave.length,
  );
  const bass = freq.slice(0, 12).reduce((s, v) => s + v, 0) / 12 / 255;
  return {
    bins: Array.from(freq, (v) => v / 255),
    wave: Array.from(wave, (v) => (v - 128) / 128),
    rms,
    bass,
    beat: bass > 0.23 && bass > previous * 1.12,
    time,
  };
}
