export type KeyLayout = ReadonlyMap<string, string>;

const US_LAYOUT: KeyLayout = new Map([
  ..."abcdefghijklmnopqrstuvwxyz".split("").map((c): [string, string] => [`Key${c.toUpperCase()}`, c]),
  ..."0123456789".split("").map((d): [string, string] => [`Digit${d}`, d]),
  ["Minus", "-"], ["Equal", "="], ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\"],
  ["Semicolon", ";"], ["Quote", "'"], ["Backquote", "`"], ["Comma", ","], ["Period", "."], ["Slash", "/"],
  ["Space", " "],
]);

interface LayoutMapNavigator {
  keyboard: { getLayoutMap(): Promise<ReadonlyMap<string, string>> };
}

const hasLayoutMap = (nav: Navigator): nav is Navigator & LayoutMapNavigator =>
  "keyboard" in nav && typeof nav.keyboard === "object" && nav.keyboard !== null && "getLayoutMap" in nav.keyboard;

export async function loadKeyLayout(): Promise<KeyLayout> {
  if (!hasLayoutMap(navigator)) return US_LAYOUT;
  const map = await navigator.keyboard.getLayoutMap();
  return new Map([...US_LAYOUT, ...map, ["Space", " "]]);
}

export interface TextKey {
  base: string;
  text: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

const KITTY_DISAMBIGUATE = 1;

/**
 * Ctrl / Alt 付きの文字キーを Ghostty と同じ形で符号化する。
 * アプリ (Neovim、Helix など) が kitty keyboard protocol (disambiguate) を要求していれば CSI u 形式。
 * Ctrl+Alt+h と Alt+Backspace のように、従来形式では区別できない組み合わせがあるため。
 */
export function encodeTextKey(key: TextKey, kittyFlags: number): string {
  if (kittyFlags & KITTY_DISAMBIGUATE) {
    const mods = 1 + (key.shift ? 1 : 0) + (key.alt ? 2 : 0) + (key.ctrl ? 4 : 0);
    return `\x1b[${key.base.codePointAt(0)};${mods}u`;
  }
  const ctrlChar = /^[a-z]$/.test(key.base) ? String.fromCharCode(key.base.charCodeAt(0) & 0x1f) : key.text;
  return `${key.alt ? "\x1b" : ""}${key.ctrl ? ctrlChar : key.text}`;
}

const KITTY_SEQUENCE = /\x1b\[([<>=])(\d*)(?:;(\d+))?u/g;

export function createKittyFlagsTracker(): { feed(chunk: string): void; flags(): number } {
  let stack: number[] = [];
  let carry = "";
  return {
    feed(chunk) {
      const text = carry + chunk;
      let consumed = 0;
      for (const match of text.matchAll(KITTY_SEQUENCE)) {
        consumed = (match.index ?? 0) + match[0].length;
        const n = Number(match[2] || 0);
        if (match[1] === ">") stack.push(n);
        else if (match[1] === "<") stack = stack.slice(0, Math.max(0, stack.length - Math.max(1, n)));
        else {
          const current = stack.pop() ?? 0;
          const mode = Number(match[3] || 1);
          stack.push(mode === 1 ? n : mode === 2 ? current | n : current & ~n);
        }
      }
      const lastEsc = text.lastIndexOf("\x1b");
      carry = lastEsc >= consumed && text.length - lastEsc < 16 ? text.slice(lastEsc) : "";
    },
    flags: () => stack.at(-1) ?? 0,
  };
}
