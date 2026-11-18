<script setup lang="ts">
import type { Analysis } from "../../../shared/types";
import type { BeatEngine } from "../../beat/model/beat";
import { computed } from "vue";
const props = defineProps<{ frame: Analysis; beat: BeatEngine }>();
const label = computed(() => {
  const loc = props.beat.state.location;
  if (!loc) return "● FREE";
  return `● ${loc.barNumber}.${loc.beatNumber + 1}`;
});
</script>
<template>
  <div class="signal-meter">
    <span>LOW END</span><i><b :style="{ width: `${frame.bass * 100}%` }"></b></i
    ><span>RMS {{ frame.rms.toFixed(3) }}</span
    ><span
      class="beat-label"
      :class="{
        lit: beat.state.flash && !beat.state.tapActive,
        grid: !!beat.state.grid,
        tap: beat.state.tapActive,
        uncertain: beat.state.location?.uncertain,
      }"
      >{{ label }}</span
    >
  </div>
</template>
