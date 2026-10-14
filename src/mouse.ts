import type { Terminal } from "ghostty-web";

export interface Cell {
  col: number;
  row: number;
}

export interface Mods {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export type MouseReport =
  | { kind: "press" | "release" | "drag"; button: 0 | 1 | 2; cell: Cell; mods: Mods }
  | { kind: "wheel"; direction: "up" | "down"; cell: Cell; mods: Mods };

/** SGR (DECSET 1006) 形式。cell は 0 始まり、送出は 1 始まり。 */
export function encodeSgrMouse(report: MouseReport): string {
  const mods = (report.mods.shift ? 4 : 0) | (report.mods.alt ? 8 : 0) | (report.mods.ctrl ? 16 : 0);
  const code =
    report.kind === "wheel"
      ? (report.direction === "up" ? 64 : 65)
      : report.button + (report.kind === "drag" ? 32 : 0);
  const final = report.kind === "release" ? "m" : "M";
  return `\x1b[<${code | mods};${report.cell.col + 1};${report.cell.row + 1}${final}`;
}

const MODE_BUTTON_MOTION = 1002;
const MODE_ANY_MOTION = 1003;
const MODE_SGR = 1006;

/**
 * ghostty-web 0.4.0 はマウス報告を実装しておらず、TUI でのクリックやスクロールが効かない。
 * アプリがマウス報告を要求している間だけ、マウス操作を SGR シーケンスにして送る。
 * Shift を押している間は ghostty-web 側のテキスト選択に任せる (Ghostty と同じ挙動)。
 */
export function attachMouseReporting(term: Terminal, host: HTMLElement, send: (data: string) => void): () => void {
  const reporting = (e: MouseEvent) => !e.shiftKey && term.hasMouseTracking() && term.getMode(MODE_SGR);
  const modsOf = (e: MouseEvent): Mods => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey });
  const cellOf = (e: MouseEvent): Cell | null => {
    const canvas = host.querySelector("canvas");
    const metrics = term.renderer?.getMetrics();
    if (!canvas || !metrics) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      col: Math.min(term.cols - 1, Math.max(0, Math.floor((e.clientX - rect.left) / metrics.width))),
      row: Math.min(term.rows - 1, Math.max(0, Math.floor((e.clientY - rect.top) / metrics.height))),
    };
  };

  let pressed: 0 | 1 | 2 | null = null;
  let lastCell = "";

  const onDown = (e: MouseEvent) => {
    const b = e.button === 0 || e.button === 1 || e.button === 2 ? e.button : null;
    const cell = cellOf(e);
    if (!reporting(e) || b === null || !cell) return;
    e.preventDefault();
    e.stopPropagation();
    term.focus();
    pressed = b;
    lastCell = `${cell.col},${cell.row}`;
    send(encodeSgrMouse({ kind: "press", button: b, cell, mods: modsOf(e) }));
  };
  const onMove = (e: MouseEvent) => {
    if (pressed === null || !(term.getMode(MODE_BUTTON_MOTION) || term.getMode(MODE_ANY_MOTION))) return;
    const cell = cellOf(e);
    if (!cell || `${cell.col},${cell.row}` === lastCell) return;
    lastCell = `${cell.col},${cell.row}`;
    e.preventDefault();
    e.stopPropagation();
    send(encodeSgrMouse({ kind: "drag", button: pressed, cell, mods: modsOf(e) }));
  };
  const onUp = (e: MouseEvent) => {
    if (pressed === null) return;
    const cell = cellOf(e);
    const b = pressed;
    pressed = null;
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    send(encodeSgrMouse({ kind: "release", button: b, cell, mods: modsOf(e) }));
  };
  const onContextMenu = (e: MouseEvent) => {
    if (reporting(e)) e.preventDefault();
  };

  // トラックパッドは 1 回の操作で細かい deltaY を大量に送るので、1 行分たまるごとに 1 ノッチ送る。
  let wheelDelta = 0;
  term.attachCustomWheelEventHandler((e) => {
    const cell = cellOf(e);
    if (!reporting(e) || !cell) return false;
    const lineHeight = term.renderer?.getMetrics().height ?? 16;
    wheelDelta += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * lineHeight;
    while (Math.abs(wheelDelta) >= lineHeight) {
      const direction = wheelDelta > 0 ? "down" : "up";
      wheelDelta -= Math.sign(wheelDelta) * lineHeight;
      send(encodeSgrMouse({ kind: "wheel", direction, cell, mods: modsOf(e) }));
    }
    return true;
  });

  host.addEventListener("mousedown", onDown, true);
  host.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  return () => {
    term.attachCustomWheelEventHandler(undefined);
    host.removeEventListener("mousedown", onDown, true);
    host.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
  };
}
