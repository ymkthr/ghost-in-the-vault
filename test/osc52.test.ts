import assert from "node:assert/strict";
import { test } from "node:test";
import { createOsc52Sniffer } from "../src/osc52.ts";

const latin1 = (s: string) => Buffer.from(s, "utf8").toString("latin1");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

test("チャンクをまたいだ OSC 52 を UTF-8 のテキストとしてコピーする", () => {
  const copied: string[] = [];
  const sniff = createOsc52Sniffer((text) => copied.push(text));
  const seq = latin1(`before\x1b]52;c;${b64("日本語 copy")}\x07after`);
  sniff(seq.slice(0, 9));
  sniff(seq.slice(9, 20));
  sniff(seq.slice(20));
  assert.deepEqual(copied, ["日本語 copy"]);
});

test("ST 終端を受け付け、クリップボード問い合わせ (?) は無視する", () => {
  const copied: string[] = [];
  const sniff = createOsc52Sniffer((text) => copied.push(text));
  sniff(`\x1b]52;c;?\x07\x1b]52;p;${b64("x")}\x1b\\`);
  assert.deepEqual(copied, ["x"]);
});
