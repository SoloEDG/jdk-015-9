<script setup lang="ts">
import type { StageDocument } from "../../../shared/types";
import type { LiveControls } from "../model/controls";
defineProps<{ doc: StageDocument; controls: LiveControls; beat: boolean }>();
</script>
<template>
  <section class="panel live-panel">
    <div class="panel-heading">
      <span>04 / PERFORMANCE</span
      ><span class="dot" :class="{ on: beat }"></span>
    </div>
    <div class="tempo">
      <div>
        <strong>{{ controls.bpm.value }}</strong
        ><span>BPM / MANUAL</span>
      </div>
      <button @click="controls.tap">TAP <kbd>T</kbd></button>
    </div>
    <div class="live-buttons">
      <button :class="{ selected: doc.frozen }" @click="controls.freeze">
        {{ doc.frozen ? "继续运动" : "冻结运动" }} <kbd>F</kbd></button
      ><button :class="{ danger: doc.blackout }" @click="controls.blackout">
        黑场 <kbd>B</kbd>
      </button>
    </div>
    <label class="control"
      >舞台亮度 <b>{{ Math.round(doc.master * 100) }}%</b
      ><input
        type="range"
        min="0"
        max="1"
        step="0.01"
        v-model.number="doc.master" /></label
    ><label class="toggle"
      ><input type="checkbox" v-model="doc.strobe" />节拍闪光
      <small>含快速闪光</small></label
    ><label class="control"
      >频谱平滑 <b>{{ doc.smoothing.toFixed(2) }}</b><input
        type="range"
        min="0"
        max="0.95"
        step="0.01"
        v-model.number="doc.smoothing"
    /></label>
  </section>
</template>
