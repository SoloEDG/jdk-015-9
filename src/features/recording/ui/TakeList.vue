<script setup lang="ts">
import type { StageRecorder } from "../model/recorder";
import { clock, download } from "../../../shared/math";
import { describeEvents, eventLabel, laneEvents } from "../lib/events";
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
    <div v-for="(t, i) in recorder.state.takes" :key="t.id" class="take-col">
      <div class="take">
        <span>↗</span>
        <div>
          <strong>Take {{ recorder.state.takes.length - i }}</strong
          ><small
            >{{ clock(t.duration) }} ·
            {{ (t.size / 1024 / 1024).toFixed(2) }} MB ·
            {{ describeEvents(t.events) }}</small
          >
        </div>
        <button @click="download(t.url, t.name)">下载</button
        ><button @click="recorder.remove(t.id)" aria-label="删除录制">×</button>
      </div>
      <div v-if="t.events?.length" class="take-events">
        <div class="event-lane">
          <i
            v-for="e in laneEvents(t.events, t.duration)"
            :key="e.seq"
            :class="['mark', e.kind]"
            :style="{ left: `${e.x * 100}%` }"
            :title="`${clock(e.time)} ${eventLabel(e)}`"
          ></i>
        </div>
        <small
          >节奏事件 {{ t.events.filter((e) => e.kind === 'bar').length }} 强拍 ·
          按录制顺序保存</small
        >
      </div>
    </div>
  </section>
</template>
