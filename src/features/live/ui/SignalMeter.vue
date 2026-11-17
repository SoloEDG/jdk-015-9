<script setup lang="ts">
import type { Analysis } from "../../../shared/types";
defineProps<{ frame: Analysis }>();
</script>
<template>
  <div class="signal-meter">
    <span>LOW END</span><i><b :style="{ width: `${frame.bass * 100}%` }"></b></i
    ><span>RMS {{ frame.rms.toFixed(3) }}</span
    ><span class="beat-label" :class="{ lit: frame.beat }">● BEAT</span>
  </div>
</template>
