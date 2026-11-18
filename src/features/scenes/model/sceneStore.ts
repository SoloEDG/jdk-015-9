import { computed } from "vue";
import type { StageDocument } from "../../../shared/types";
import type { BeatEngine } from "../../beat/model/beat";
export function createScenes(doc: StageDocument, beat: BeatEngine) {
  const active = computed(
    () => doc.scenes.find((s) => s.id === doc.activeId) ?? doc.scenes[0],
  );
  function select(id: string) {
    const scene = doc.scenes.find((s) => s.id === id);
    if (!scene) return;
    // quantise to the next downbeat when a confirmed grid is running;
    // the scene only changes when the cue actually fires
    beat.queueScene(() => {
      doc.activeId = scene.id;
    }, scene.name);
  }
  function next() {
    select(
      doc.scenes[
        (doc.scenes.findIndex((s) => s.id === doc.activeId) + 1) %
          doc.scenes.length
      ].id,
    );
  }
  return { active, select, next };
}
export type SceneStore = ReturnType<typeof createScenes>;
