import type { TakeEvent, TakeEventKind } from "../../../shared/types";

export interface CaptureLogEvent {
  kind: TakeEventKind;
  songTime: number;
  bar?: number;
  beat?: number;
  bpm?: number;
  label?: string;
  uncertain?: boolean;
}

/**
 * Ordered event log for one take. Marks are time-stamped with the take's own
 * wall clock, so loop repeats, seeks and late taps can never place a beat
 * marker before one that was already written.
 */
export function createCaptureLog() {
  const events: TakeEvent[] = [];
  let lastTime = 0;

  function begins() {
    events.length = 0;
    lastTime = 0;
  }

  function record(event: CaptureLogEvent, elapsed: number) {
    // clamp forward: strict monotonicity is what keeps the marks legible
    const time = Math.max(lastTime, Math.max(0, elapsed));
    lastTime = time;
    events.push({
      seq: events.length + 1,
      time,
      kind: event.kind,
      bar: event.bar,
      beat: event.beat,
      bpm: event.bpm,
      label: event.label,
    });
    return true;
  }

  function snapshot(elapsed: number) {
    return events
      .filter((e) => e.time <= Math.max(lastTime, elapsed) + 0.05)
      .map((e) => ({ ...e }));
  }

  return {
    begins,
    record,
    snapshot,
    count: () => events.length,
  };
}
export type CaptureLog = ReturnType<typeof createCaptureLog>;
