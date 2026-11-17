<script setup lang="ts">
import type { Scene } from "../../../shared/types";
import { themes } from "../model/themes";
defineProps<{ scene: Scene }>();
</script>
<template>
  <section class="panel themes">
    <div class="panel-heading">
      <span>03 / VISUAL PALETTE</span><span>4 THEMES</span>
    </div>
    <div class="theme-options">
      <button
        v-for="t in themes"
        :key="t.id"
        :class="{ selected: scene.theme === t.id }"
        @click="scene.theme = t.id"
      >
        <span
          class="swatch"
          :style="{
            background: `linear-gradient(130deg,${t.background},${t.colors[0]},${t.colors[1]})`,
          }"
          ><span v-if="scene.theme === t.id">✓</span></span
        >{{ t.name }}
      </button>
    </div>
    <div class="two-controls">
      <label class="control"
        >视觉强度 <b>{{ Math.round(scene.intensity * 100) }}%</b
        ><input
          type="range"
          min="0.1"
          max="1.5"
          step="0.05"
          v-model.number="scene.intensity" /></label
      ><label class="control"
        >运动速度 <b>{{ scene.speed.toFixed(1) }}×</b
        ><input
          type="range"
          min="0.1"
          max="2"
          step="0.1"
          v-model.number="scene.speed"
      /></label>
    </div>
  </section>
</template>
