import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSgrMouse } from "../src/mouse.ts";

const none = { shift: false, alt: false, ctrl: false };

test("SGR マウス報告は 1 始まりの座標で、離したときだけ m で終わる", () => {
  const cell = { col: 0, row: 4 };
  assert.equal(encodeSgrMouse({ kind: "press", button: 0, cell, mods: none }), "\x1b[<0;1;5M");
  assert.equal(encodeSgrMouse({ kind: "drag", button: 0, cell, mods: none }), "\x1b[<32;1;5M");
  assert.equal(encodeSgrMouse({ kind: "release", button: 2, cell, mods: none }), "\x1b[<2;1;5m");
});

test("ホイールと修飾キーはボタン番号に加算される", () => {
  const cell = { col: 9, row: 0 };
  assert.equal(encodeSgrMouse({ kind: "wheel", direction: "up", cell, mods: none }), "\x1b[<64;10;1M");
  assert.equal(encodeSgrMouse({ kind: "wheel", direction: "down", cell, mods: { ...none, ctrl: true } }), "\x1b[<81;10;1M");
});
