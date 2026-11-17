<script setup lang="ts">
import type { StageRecorder } from "../model/recorder";
import { clock, download } from "../../../shared/math";
defineProps<{ recorder: StageRecorder }>();
</script>
<template>
  <section class="take-list">
    <div class="panel-heading">
      <span>SESSION TAKES</span
      ><span>{{
        recorder.state.takes.length.toString().padStart(2, "0")
      }}</span>
    </div>
    <p v-if="!recorder.state.takes.length" class="muted">
      还没有录制片段。下一场演出，值得被记住。
    </p>
    <div v-for="(t, i) in recorder.state.takes" :key="t.id" class="take">
      <span>↗</span>
      <div>
        <strong>Take {{ recorder.state.takes.length - i }}</strong
        ><small
          >{{ clock(t.duration) }} ·
          {{ (t.size / 1024 / 1024).toFixed(2) }} MB</small
        >
      </div>
      <button @click="download(t.url, t.name)">下载</button
      ><button @click="recorder.remove(t.id)" aria-label="删除录制">×</button>
    </div>
  </section>
</template>
