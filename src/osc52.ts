const START = "\x1b]52;";

/**
 * zellij はコピーを OSC 52 で端末へ送るが、ghostty-web は OSC 52 を処理しない。
 * 出力ストリーム (latin1 で 1 バイト 1 文字にしたもの) から OSC 52 を拾ってクリップボードへ渡す。
 */
export function createOsc52Sniffer(onCopy: (text: string) => void): (chunk: string) => void {
  let pending = "";
  return (chunk) => {
    pending += chunk;
    for (;;) {
      const start = pending.indexOf(START);
      if (start < 0) {
        pending = pending.slice(-(START.length - 1));
        return;
      }
      const bel = pending.indexOf("\x07", start);
      const st = pending.indexOf("\x1b\\", start);
      const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
      if (end < 0) {
        pending = pending.slice(start);
        return;
      }
      const body = pending.slice(start + START.length, end);
      pending = pending.slice(end + (end === bel ? 1 : 2));
      const payload = body.slice(body.indexOf(";") + 1);
      if (payload !== "?") onCopy(Buffer.from(payload, "base64").toString("utf8"));
    }
  };
}
