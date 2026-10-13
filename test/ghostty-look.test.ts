import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShowConfig } from "../src/ghostty-look.ts";

// `ghostty +show-config` の実出力から抜粋。palette はテーマ分と既定分で 2 回出る。
const SHOW_CONFIG = `font-family = HackGen Console NF
font-family-bold = HackGen Console NF
font-size = 14
theme = GitHub Dark High Contrast
background = #0a0c10
foreground = #f0f3f6
palette = 0=#7a828e
palette = 15=#ffffff
palette = 16=#000000
palette = 0=#7a828e
cursor-color = #71b7ff
cursor-style = bar
cursor-style-blink = false
cursor-text = #b1f7ff
macos-option-as-alt = left
window-title-font-family = 
`;

test("テーマ適用済みの色・フォント・カーソルを読み取る", () => {
  const look = parseShowConfig(SHOW_CONFIG, "darwin");
  assert.equal(look.fontFamily, '"HackGen Console NF", monospace');
  assert.equal(look.fontSize, 14);
  assert.deepEqual(look.theme, {
    background: "#0a0c10",
    foreground: "#f0f3f6",
    black: "#7a828e",
    brightWhite: "#ffffff",
    cursor: "#71b7ff",
    cursorAccent: "#b1f7ff",
  });
  assert.equal(look.cursorStyle, "bar");
  assert.equal(look.cursorBlink, false);
  assert.equal(look.optionAsAlt, "left");
});

test("Linux ではポイントを 96dpi で px に換算し、Option 設定は無視して Alt を常に Alt とする", () => {
  const look = parseShowConfig(SHOW_CONFIG, "linux");
  assert.equal(look.fontSize, (14 * 96) / 72);
  assert.equal(look.optionAsAlt, "both");
});
