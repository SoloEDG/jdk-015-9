export type SceneKind = "orbit" | "spectrum" | "wave" | "tunnel";
export interface Scene {
  id: string;
  name: string;
  kind: SceneKind;
  theme: string;
  intensity: number;
  speed: number;
}
export interface Analysis {
  bins: number[];
  wave: number[];
  rms: number;
  bass: number;
  beat: boolean;
  time: number;
}
export interface StageDocument {
  scenes: Scene[];
  activeId: string;
  gain: number;
  sensitivity: number;
  smoothing: number;
  transition: number;
  blackout: boolean;
  frozen: boolean;
  strobe: boolean;
  master: number;
}
export type TakeEventKind = "beat" | "bar" | "scene" | "manual";
export interface TakeEvent {
  seq: number;
  time: number;
  kind: TakeEventKind;
  bar?: number;
  beat?: number;
  bpm?: number;
  label?: string;
}
export interface Take {
  id: string;
  url: string;
  size: number;
  duration: number;
  name: string;
  mime: string;
  events?: TakeEvent[];
}
export interface Theme {
  id: string;
  name: string;
  colors: [string, string, string];
  background: string;
}
