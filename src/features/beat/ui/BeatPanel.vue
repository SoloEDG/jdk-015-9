<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { BeatEngine } from "../model/beat";
import type { AudioEngine } from "../../audio/model/engine";
import { buildWaveform, type Waveform } from "../lib/waveform";
import { uncertainRuns, gridSummary } from "../lib/grid";
import { clock } from "../../../shared/math";
import BeatGridEditor from "./BeatGridEditor.vue";

const props = defineProps<{ beat: BeatEngine; audio: AudioEngine }>();
const selectedBar = ref(1);
const busy = ref(false);
const waveform = ref<Waveform | null>(null);
const runIndex = ref(0);
const selected = computed(() =>
  props.beat.state.grid?.bars.find((b) => b.index === selectedBar.value),
);
const summary = computed(() =>
  props.beat.state.grid ? gridSummary(props.beat.state.grid) : null,
);
const runs = computed(() =>
  props.beat.state.grid ? uncertainRuns(props.beat.state.grid) : [],
);
const currentRun = computed(() => runs.value[runIndex.value] ?? runs.value[0]);
const loopLength = computed(() => {
  const loop = props.audio.state.loop;
  return Math.max(0, loop.end - loop.start);
});
const candidateRows = computed(() => props.beat.state.candidates.slice(0, 4));

function analyse() {
  if (busy.value) return;
  busy.value = true;
  void props.beat.analyse().finally(() => (busy.value = false));
}
function adopt(id: string) {
  const candidate = props.beat.state.candidates.find((c) => c.id === id);
  if (candidate) {
    props.beat.adopt(candidate);
    selectedBar.value = 1;
    runIndex.value = 0;
    if (props.beat.state.grid && !props.audio.state.playing)
      props.audio.seek(props.beat.state.grid.bars[0]?.time ?? 0);
  }
}
function stepRun(dir: number) {
  const total = runs.value.length;
  if (!total) return;
  runIndex.value = (runIndex.value + dir + total) % total;
}
function auditionRun() {
  const run = currentRun.value;
  if (run) props.beat.auditionRun(run.start, run.end, `待确认 ${run.from}–${run.to}`);
}
function auditionSelectedBar() {
  props.beat.auditionBar(selectedBar.value);
}
function tapRelease() {
  props.beat.releaseTap();
}
function loopFromGrid() {
  const grid = props.beat.state.grid;
  if (!grid || !selected.value) return;
  const end = grid.bars.find((b) => b.index === selectedBar.value + 1);
  const start = selected.value.time;
  const stop = end?.time ?? grid.duration;
  props.audio.setLoop(start, stop, true);
}
function loopTwoBars() {
  const grid = props.beat.state.grid;
  if (!grid || !selected.value) return;
  const first = selected.value;
  const third = grid.bars.find((b) => b.index === selectedBar.value + 2);
  props.audio.setLoop(first.time, third?.time ?? grid.duration, true);
}

async function refreshWaveform() {
  const buffer = props.audio.buffer();
  waveform.value = buffer ? buildWaveform(buffer) : null;
}
watch(
  () => props.audio.state.loadedTick,
  () => {
    void refreshWaveform();
    selectedBar.value = 1;
    runIndex.value = 0;
  },
);
watch(
  () => props.beat.state.gridVersion,
  () => {
    if (!waveform.value) void refreshWaveform();
    const grid = props.beat.state.grid;
    if (grid && !grid.bars.some((b) => b.index === selectedBar.value))
      selectedBar.value = grid.bars[grid.bars.length - 1]?.index ?? 1;
  },
);
onMounted(() => {
  void refreshWaveform();
  // the demo buffer is created lazily on the first user gesture
  const retry = window.setInterval(() => {
    if (waveform.value) {
      clearInterval(retry);
      return;
    }
    void refreshWaveform();
  }, 500);
  window.setTimeout(() => clearInterval(retry), 15000);
  onUnmounted(() => clearInterval(retry));
});
</script>
<template>
  <section class="panel beat-panel">
    <div class="panel-heading">
      <span>06 / BEAT GRID</span>
      <span>{{
        beat.state.grid
          ? beat.state.tapActive
            ? "TAP HOLD"
            : "GRID LOCK"
          : beat.state.status === "detecting"
            ? "ANALYSING…"
            : "FREE RUN"
      }}</span>
    </div>
    <div class="beat-readout">
      <div class="beat-big" :class="{ flash: beat.state.flash }">
        <strong>{{ beat.state.displayBpm }}</strong
        ><span>BPM</span>
      </div>
      <div class="beat-count">
        <template v-if="beat.state.location">
          <strong
            ><b>{{ beat.state.location.barNumber }}</b> .{{
              beat.state.location.beatNumber + 1
            }}</strong
          ><small
            >小节 . 拍 ·
            {{
              beat.state.location.uncertain ? "待确认小节" : "强拍已对齐"
            }}</small
          >
        </template>
        <template v-else>
          <strong>— . —</strong
          ><small>尚无网格 · 可识别或手动敲击</small>
        </template>
        <div class="beat-dots" v-if="beat.state.location">
          <i
            v-for="i in beat.state.grid?.beatsPerBar ?? 4"
            :key="i"
            :class="{
              lit:
                (beat.state.grid?.beatsPerBar ?? 4) - i ===
                beat.state.location.beatNumber,
              manual: beat.state.flashManual,
            }"
          ></i>
        </div>
      </div>
      <span
        class="dot"
        :class="{ on: beat.state.flash && !beat.state.tapActive }"
      ></span>
    </div>

    <p v-if="beat.state.tapActive" class="beat-notice tap">
      手动敲击接管中（{{ beat.state.tapBpm }} BPM）：网格保持不变，衰减后自动交还。
      <button @click="tapRelease">立即交还</button>
    </p>
    <p v-else-if="beat.state.pendingScene" class="beat-notice">
      {{ beat.state.pendingScene }} 将在下一强拍进入
      <button @click="beat.cancelQueuedScene">取消</button>
    </p>

    <div class="beat-actions">
      <button
        :disabled="!audio.state.analysable || beat.state.status === 'detecting'"
        @click="analyse"
      >
        {{ beat.state.status === "detecting" ? "分析中…" : "识别速度与强拍" }}
      </button>
      <button
        @click="beat.adoptManualGrid(beat.state.tapBpm)"
      >
        {{ beat.state.grid ? "用敲击速度重建网格" : "用敲击速度手动建网格" }}
      </button>
    </div>
    <p v-if="beat.state.error" role="alert">{{ beat.state.error }}</p>
    <p v-else-if="beat.state.autoNotice" class="beat-notice">
      {{ beat.state.autoNotice }}
    </p>

    <div v-if="candidateRows.length" class="candidate-list">
      <div class="candidate-head">
        <span>候选解释 · 试听后再确认</span
        ><small>{{ candidateRows.length }} / {{ beat.state.candidates.length }}</small>
      </div>
      <article
        v-for="c in candidateRows"
        :key="c.id"
        class="candidate"
        :class="{
          applied: beat.state.appliedCandidateId === c.id,
          preview: beat.state.preview.playing && beat.state.preview.label === c.label,
        }"
      >
        <div>
          <strong>{{ c.label }}</strong
          ><small>{{ c.bpm }} BPM · {{ c.notes }}</small>
        </div>
        <button
          class="ghost"
          @click="
            beat.state.preview.playing && beat.state.preview.label === c.label
              ? beat.stopPreview()
              : beat.auditionCandidate(c)
          "
        >
          {{
            beat.state.preview.playing && beat.state.preview.label === c.label
              ? "停止"
              : "试听"
          }}
        </button>
        <button
          :class="{ selected: beat.state.appliedCandidateId === c.id }"
          @click="adopt(c.id)"
        >
          {{ beat.state.appliedCandidateId === c.id ? "使用中" : "采用" }}
        </button>
      </article>
      <button v-if="beat.state.preview.playing" class="ghost stop-preview" @click="beat.stopPreview">
        停止试听（{{ beat.state.preview.label }}）
      </button>
    </div>

    <div class="grid-tools">
      <span class="tool-label">波形校准</span>
      <span class="tool-help">拖动竖线移动强拍 · 点击空白定位 · 拖动顶部标记设循环</span>
    </div>
    <BeatGridEditor
      :beat="beat"
      :audio="audio"
      :waveform="waveform"
      :selected-bar="selectedBar"
      @select="selectedBar = $event"
    />
    <div v-if="beat.state.grid" class="grid-edit">
      <div class="bar-edit">
        <button @click="selectedBar = Math.max(1, selectedBar - 1)">‹</button>
        <span
          >第 <b>{{ selectedBar }}</b> 小节
          <i v-if="selected" :class="{ uncertain: selected.uncertain }">{{
            selected.uncertain ? "待确认" : selected.source === "edited" ? "已修正" : "已识别"
          }}</i></span
        >
        <button
          @click="
            selectedBar = Math.min(
              beat.state.grid.bars.length,
              selectedBar + 1,
            )
          "
        >
          ›
        </button>
        <button class="ghost" :disabled="!selected" @click="auditionSelectedBar">
          试听
        </button>
      </div>
      <div class="nudge-row">
        <button :disabled="!selected" @click="beat.nudgeDownbeat(selectedBar, -0.01)">
          −10ms
        </button>
        <button :disabled="!selected" @click="beat.nudgeDownbeat(selectedBar, 0.01)">
          +10ms
        </button>
        <button
          :disabled="!selected"
          :class="{ selected: selected?.uncertain }"
          @click="beat.markUncertain(selectedBar, !selected?.uncertain)"
        >
          {{ selected?.uncertain ? "标记已确认" : "标记待确认" }}
        </button>
        <button :disabled="!selected" @click="beat.markUncertain(selectedBar, true)">
          保留不确定
        </button>
      </div>
      <div class="nudge-row">
        <button @click="beat.shiftGrid(-0.01)">整体 −10ms</button>
        <button @click="beat.shiftGrid(0.01)">整体 +10ms</button>
        <button @click="beat.rescale(2)">按半速理解</button>
        <button @click="beat.rescale(0.5)">按双速理解</button>
      </div>
      <label class="control compact"
        >每小节拍数
        <select
          :value="beat.state.grid.beatsPerBar"
          @change="
            beat.setBeatsPerBar(Number(($event.target as HTMLSelectElement).value))
          "
        >
          <option v-for="n in [2, 3, 4, 5, 6, 7]" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </div>

    <div v-if="runs.length" class="uncertain-runs">
      <div class="candidate-head">
        <span>不确定区段 · 逐段试听</span><small>{{ runIndex + 1 }} / {{ runs.length }}</small>
      </div>
      <div class="run-row">
        <button @click="stepRun(-1)">‹</button>
        <div>
          <strong>{{ currentRun?.from }}–{{ currentRun?.to }} 小节</strong
          ><small
            >{{ clock(currentRun?.start ?? 0) }} – {{ clock(currentRun?.end ?? 0) }}</small
          >
        </div>
        <button class="ghost" @click="auditionRun">试听</button>
        <button v-if="beat.state.preview.playing" @click="beat.stopPreview">
          停止
        </button>
      </div>
      <div class="run-row subtle">
        <button
          :disabled="!currentRun"
          @click="
            selectedBar = currentRun!.from;
            beat.auditionBar(currentRun!.from);
          "
        >
          逐小节修正
        </button>
        <button
          :disabled="!currentRun"
          @click="
            currentRun &&
              beat.state.grid?.bars
                .filter((b) => b.index >= currentRun!.from && b.index <= currentRun!.to)
                .forEach((b) => beat.markUncertain(b.index, false));
          "
        >
          本区段全部确认
        </button>
      </div>
    </div>

    <div class="loop-tools" v-if="beat.state.grid">
      <div class="candidate-head">
        <span>循环点 · 对齐小节</span
        ><small>{{ clock(loopLength) }} · 音乐编号连续</small>
      </div>
      <div class="nudge-row">
        <button @click="loopFromGrid">循环第 {{ selectedBar }} 小节</button>
        <button @click="loopTwoBars">两小节</button>
        <button
          :class="{ selected: audio.state.loop.enabled }"
          @click="
            audio.state.loop.enabled
              ? audio.setLoopEnabled(false)
              : loopFromGrid()
          "
        >
          {{ audio.state.loop.enabled ? "关闭循环" : "开启循环" }}
        </button>
      </div>
      <p class="tool-help">
        循环内小节的绝对编号保持不变；跳转与暂停恢复不会重播已经走过的拍。
      </p>
    </div>
    <div class="grid-foot">
      <span v-if="summary"
        >{{ summary.bars }} 小节 · {{ summary.uncertainBars }} 待确认 ·
        {{ summary.editedBars }} 已修正</span
      >
      <button v-if="beat.state.grid" class="ghost" @click="beat.clearGrid">
        移除网格
      </button>
    </div>
  </section>
</template>
