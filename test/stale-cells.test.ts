import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ghostty, type GhosttyTerminal } from "ghostty-web";

const { instance } = await WebAssembly.instantiate(readFileSync(new URL("../vendor/ghostty-vt.wasm", import.meta.url)), {
  env: { log: () => {} },
});
const ghostty = new Ghostty(instance);

const rowsText = (t: GhosttyTerminal) =>
  Array.from({ length: t.rows }, (_, y) =>
    (t.getLine(y) ?? []).map((c) => (c.codepoint ? String.fromCodePoint(c.codepoint) : " ")).join("").trimEnd(),
  );

const freeAfterWriting = (text: string) => {
  const old = ghostty.createTerminal(40, 6);
  old.write(text);
  old.update();
  old.free();
};

test("閉じたターミナルと同じ大きさで開き直しても、前の内容は残らない", () => {
  freeAfterWriting("old-line-1\r\nold-line-2\r\nold-line-3");
  const fresh = ghostty.createTerminal(40, 6);
  fresh.update();
  assert.deepEqual(rowsText(fresh).filter(Boolean), []);
  fresh.free();
});

test("スクロールで増えた行に、再利用されたメモリの内容が出てこない", () => {
  freeAfterWriting(Array.from({ length: 300 }, (_, i) => `old-${i}\r\n`).join(""));
  const term = ghostty.createTerminal(40, 6);
  const leaked: string[] = [];
  for (let i = 0; i < 300; i++) {
    term.write(i % 2 ? "\r\n" : `n${i}\r\n`);
    term.update();
    leaked.push(...rowsText(term).filter((row) => row.includes("old-")));
  }
  assert.deepEqual(leaked, []);
  term.free();
});
