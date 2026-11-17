import { computed } from "vue";
import type { StageDocument } from "../../../shared/types";
export function createScenes(doc: StageDocument) {
  const active = computed(
    () => doc.scenes.find((s) => s.id === doc.activeId) ?? doc.scenes[0],
  );
  function select(id: string) {
    if (doc.scenes.some((s) => s.id === id)) doc.activeId = id;
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
