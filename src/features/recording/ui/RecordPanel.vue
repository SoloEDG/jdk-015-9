<script setup lang="ts">
import type { StageRecorder } from "../model/recorder";
import { clock } from "../../../shared/math";
defineProps<{ recorder: StageRecorder }>();
defineEmits<{ start: [] }>();
</script>
<template>
  <section class="panel record-panel">
    <div class="panel-heading">
      <span>05 / CAPTURE SESSION</span><span>1280 × 720</span>
    </div>
    <div class="record-top">
      <div>
        <strong>把现场留住。</strong><small>舞台画面 + 音频 · 30 FPS</small>
      </div>
      <span class="record-clock">{{ clock(recorder.state.elapsed) }}</span>
    </div>
    <button
      class="record-button"
      :disabled="recorder.state.status === 'saving'"
      @click="
        recorder.state.status === 'idle' ? $emit('start') : recorder.stop()
      "
    >
      <span></span
      >{{
        recorder.state.status === "idle"
          ? "开始录制"
          : recorder.state.status === "saving"
            ? "正在保存…"
            : "停止录制"
      }}
    </button>
    <p v-if="recorder.state.error" role="alert">{{ recorder.state.error }}</p>
    <small class="muted">切换场景不中断录制 · 保存于本次会话</small>
  </section>
</template>
