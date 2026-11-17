import { reactive } from "vue";
import type { StageDocument } from "./types";
export function createDocument(): StageDocument {
  return reactive({
    scenes: [
      {
        id: "s1",
        name: "Celestial orbit",
        kind: "orbit",
        theme: "violet",
        intensity: 0.8,
        speed: 1,
      },
      {
        id: "s2",
        name: "Frequency field",
        kind: "spectrum",
        theme: "mint",
        intensity: 0.75,
        speed: 1,
      },
      {
        id: "s3",
        name: "Liquid signal",
        kind: "wave",
        theme: "ember",
        intensity: 0.7,
        speed: 0.6,
      },
      {
        id: "s4",
        name: "Into the void",
        kind: "tunnel",
        theme: "ice",
        intensity: 0.9,
        speed: 1.2,
      },
    ],
    activeId: "s1",
    gain: 0.65,
    sensitivity: 1.2,
    smoothing: 0.78,
    transition: 1.2,
    blackout: false,
    frozen: false,
    strobe: false,
    master: 1,
  });
}
