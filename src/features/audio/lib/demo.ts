export function demoBuffer(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate,
    b = ctx.createBuffer(2, rate * 16, rate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / rate,
        beat = t % 0.5,
        bar = Math.floor(t / 2) % 4,
        notes = [110, 130.81, 98, 146.83];
      const kick =
        Math.sin(2 * Math.PI * (48 * beat + 12 * (1 - Math.exp(-beat * 35)))) *
        Math.exp(-beat * 14);
      const pad =
        Math.sin(t * Math.PI * 2 * notes[bar]) * 0.14 +
        Math.sin(t * Math.PI * 2 * notes[bar] * 1.5) * 0.07;
      const hat =
        ((Math.sin(i * 78.233 + c * 2) * 43758.5453) % 1) *
        Math.exp(-(t % 0.25) * 90) *
        0.12;
      d[i] = (kick * 0.65 + pad + hat) * 0.7;
    }
  }
  return b;
}
