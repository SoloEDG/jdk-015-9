export function bindShortcuts(actions: {
  play: () => void;
  scene: (i: number) => void;
  blackout: () => void;
  freeze: () => void;
  tap: () => void;
}) {
  const handler = (e: KeyboardEvent) => {
    if (
      (e.target as HTMLElement)?.closest("input,textarea,select,button") ||
      e.repeat ||
      e.metaKey ||
      e.ctrlKey
    )
      return;
    if (e.code === "Space") {
      e.preventDefault();
      actions.play();
    }
    if (/^[1-4]$/.test(e.key)) actions.scene(Number(e.key) - 1);
    if (e.key.toLowerCase() === "b") actions.blackout();
    if (e.key.toLowerCase() === "f") actions.freeze();
    if (e.key.toLowerCase() === "t") actions.tap();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
