import type { StageDocument } from "../../../shared/types";
import type { BeatEngine } from "../../beat/model/beat";

export function createControls(doc: StageDocument, beat: BeatEngine) {
  function tap() {
    beat.tap();
  }
  function blackout() {
    doc.blackout = !doc.blackout;
  }
  function freeze() {
    doc.frozen = !doc.frozen;
  }
  function bpm() {
    return beat.state.displayBpm;
  }
  return { bpm, tap, blackout, freeze };
}
export type LiveControls = ReturnType<typeof createControls>;
