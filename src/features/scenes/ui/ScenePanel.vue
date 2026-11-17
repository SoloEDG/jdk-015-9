<script setup lang="ts">
import type { StageDocument } from "../../../shared/types";
import type { SceneStore } from "../model/sceneStore";
import { catalog } from "../lib/catalog";
defineProps<{ doc: StageDocument; store: SceneStore }>();
</script>
<template>
  <section class="panel scene-panel">
    <div class="panel-heading">
      <span>02 / SCENE COLLECTION</span><span>04</span>
    </div>
    <button
      v-for="(s, i) in doc.scenes"
      :key="s.id"
      class="scene-row"
      :class="{ active: doc.activeId === s.id }"
      @click="store.select(s.id)"
    >
      <div class="scene-thumb" :class="s.kind">
        {{ catalog.find((c) => c.kind === s.kind)?.icon }}
      </div>
      <div>
        <strong>{{ s.name }}</strong
        ><small>{{
          catalog.find((c) => c.kind === s.kind)?.description
        }}</small>
      </div>
      <kbd>{{ i + 1 }}</kbd></button
    ><label class="control"
      >场景过渡 <b>{{ doc.transition.toFixed(1) }}s</b
      ><input
        type="range"
        min="0"
        max="4"
        step="0.1"
        v-model.number="doc.transition"
    /></label>
  </section>
</template>
