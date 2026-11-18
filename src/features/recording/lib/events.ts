import type { TakeEvent } from "../../../shared/types";

const LABELS: Record<TakeEvent["kind"], string> = {
  bar: "强拍",
  beat: "拍",
  scene: "场景",
  manual: "手动",
};

export const eventLabel = (e: TakeEvent) => {
  if (e.kind === "bar" && e.bar !== undefined) return `第 ${e.bar} 小节`;
  if (e.kind === "beat" && e.bar !== undefined)
    return `${e.bar}.${(e.beat ?? 0) + 1}`;
  return e.label || LABELS[e.kind];
};

export const eventGlyph = (e: TakeEvent) =>
  e.kind === "bar" ? "▍" : e.kind === "scene" ? "◆" : e.kind === "manual" ? "▲" : "·";

/** Compact per-take description: bar count, uncertainty, scene cues. */
export function describeEvents(events: TakeEvent[] | undefined) {
  if (!events?.length) return "无节拍事件";
  const bars = events.filter((e) => e.kind === "bar").length;
  const scenes = events.filter((e) => e.kind === "scene").length;
  return `${bars} 小节 · ${scenes} 场景标记`;
}

/** Ordered marks for a timeline lane; assumed already monotonic. */
export function laneEvents(events: TakeEvent[] | undefined, duration: number) {
  if (!events?.length || duration <= 0) return [];
  return events
    .filter((e) => e.kind === "bar" || e.kind === "scene")
    .map((e) => ({ ...e, x: Math.max(0, Math.min(1, e.time / duration)) }));
}
