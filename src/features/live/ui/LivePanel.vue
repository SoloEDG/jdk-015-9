<script setup lang="ts">
import type { StageDocument } from "../../../shared/types";
import type { LiveControls } from "../model/controls";
import type { BeatEngine } from "../../beat/model/beat";
defineProps<{
  doc: StageDocument;
  controls: LiveControls;
  beat: BeatEngine;
  beatPulse: boolean;
}>();
</script>
<template>
  <section class="panel live-panel">
    <div class="panel-heading">
      <span>04 / PERFORMANCE</span
      ><span class="dot" :class="{ on: beatPulse }"></span>
    </div>
    <div class="tempo">
      <div>
        <strong>{{ controls.bpm() }}</strong
        ><span>{{
          beat.state.tapActive
            ? "BPM / TAP TAKEOVER"
            : beat.state.grid
              ? "BPM / GRID"
              : "BPM / MANUAL"
        }}</span>
      </div>
      <button :class="{ selected: beat.state.tapActive }" @click="controls.tap">
        TAP <kbd>T</kbd>
      </button>
    </div>
    <div class="beat-status" v-if="beat.state.grid">
      <span
        ><b v-if="beat.state.location">{{
          beat.state.location.barNumber
        }}</b>
        ·
        <b v-if="beat.state.location">{{
          beat.state.location.beatNumber + 1
        }}</b></span
      >
      <small
        >{{ beat.state.tapActive ? "手动节拍临时接管，网格保留" : "节拍指示与场景触发共用此网格" }}</small
      >
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
