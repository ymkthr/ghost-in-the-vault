import assert from "node:assert/strict";
import { test } from "node:test";
import { createKittyFlagsTracker, encodeTextKey } from "../src/keys.ts";

const key = (over: Partial<Parameters<typeof encodeTextKey>[0]>) => ({ base: "h", text: "h", shift: false, alt: false, ctrl: false, ...over });

test("kitty disambiguate では zellij の Alt Shift / Ctrl Alt バインドが区別できる CSI u を送る", () => {
  assert.equal(encodeTextKey(key({ alt: true, shift: true, text: "H" }), 1), "\x1b[104;4u");
  assert.equal(encodeTextKey(key({ alt: true, ctrl: true }), 1), "\x1b[104;7u");
  assert.equal(encodeTextKey(key({ base: ";", text: "+", alt: true, shift: true }), 1), "\x1b[59;4u");
});

test("kitty が無効なら従来形式で ESC を前置する", () => {
  assert.equal(encodeTextKey(key({ alt: true, shift: true, text: "H" }), 0), "\x1bH");
  assert.equal(encodeTextKey(key({ base: "o", text: "o", alt: true, ctrl: true }), 0), "\x1b\x0f");
});

test("kitty フラグは push / pop / set を追い、チャンク境界で切れた列も拾う", () => {
  const tracker = createKittyFlagsTracker();
  tracker.feed("hello\x1b[>");
  tracker.feed("1uworld");
  assert.equal(tracker.flags(), 1);
  tracker.feed("\x1b[=5;2u");
  assert.equal(tracker.flags(), 5);
  tracker.feed("\x1b[<u");
  assert.equal(tracker.flags(), 0);
  tracker.feed("\x1b[<u");
  assert.equal(tracker.flags(), 0);
});
