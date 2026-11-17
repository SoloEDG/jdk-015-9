<script setup lang="ts">
import type { StageDocument } from "../../../shared/types";
defineProps<{ doc: StageDocument }>();
defineEmits<{ select: [string] }>();
</script>
<template>
  <div class="scene-strip">
    <span>QUICK CUES</span
    ><button
      v-for="(s, i) in doc.scenes"
      :key="s.id"
      @click="$emit('select', s.id)"
      :class="{ selected: doc.activeId === s.id }"
    >
      <b>0{{ i + 1 }}</b
      >{{ s.name }}<i v-if="doc.activeId === s.id">LIVE</i>
    </button>
  </div>
</template>
