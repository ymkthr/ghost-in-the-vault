import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { ITheme } from "ghostty-web";

export type CursorStyle = "block" | "bar" | "underline";
export type OptionAsAlt = "none" | "left" | "right" | "both";

export interface GhosttyLook {
  fontFamily: string;
  fontSize: number;
  theme: ITheme;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  optionAsAlt: OptionAsAlt;
}

export type LookResult =
  | { kind: "loaded"; look: GhosttyLook }
  | { kind: "fallback"; look: GhosttyLook; reason: string };

const PALETTE = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const satisfies readonly (keyof ITheme)[];

const SCALAR_COLORS = {
  background: "background",
  foreground: "foreground",
  "cursor-color": "cursor",
  "cursor-text": "cursorAccent",
  "selection-background": "selectionBackground",
  "selection-foreground": "selectionForeground",
} as const satisfies Record<string, keyof ITheme>;

const isScalarColorKey = (key: string): key is keyof typeof SCALAR_COLORS => key in SCALAR_COLORS;

const OPTION_AS_ALT: Record<string, OptionAsAlt> = { false: "none", true: "both", left: "left", right: "right" };

export function parseShowConfig(text: string, platform: NodeJS.Platform): GhosttyLook {
  const fonts: string[] = [];
  const theme: ITheme = {};
  let pointSize = 13;
  let cursorStyle: CursorStyle = "block";
  let cursorBlink = true;
  let optionAsAlt: OptionAsAlt = "none";

  for (const line of text.split("\n")) {
    const eq = line.indexOf(" = ");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 3).trim();
    if (value === "") continue;

    if (key === "font-family") {
      if (!fonts.includes(value)) fonts.push(value);
    } else if (key === "font-size") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n) && n > 0) pointSize = n;
    } else if (key === "palette") {
      const [index, color] = value.split("=");
      const name = PALETTE[Number(index)];
      if (name && color) theme[name] = color;
    } else if (isScalarColorKey(key)) {
      theme[SCALAR_COLORS[key]] = value;
    } else if (key === "cursor-style") {
      cursorStyle = value === "bar" || value === "underline" ? value : "block";
    } else if (key === "cursor-style-blink") {
      cursorBlink = value !== "false";
    } else if (key === "macos-option-as-alt") {
      optionAsAlt = OPTION_AS_ALT[value] ?? "none";
    }
  }

  return {
    fontFamily: [...(fonts.length > 0 ? fonts : ["JetBrains Mono"]), "monospace"]
      .map((f) => (f === "monospace" ? f : JSON.stringify(f)))
      .join(", "),
    // Ghostty の font-size はポイント。macOS は 1pt = 1 CSS px、Linux は 96dpi 換算。
    fontSize: platform === "darwin" ? pointSize : (pointSize * 96) / 72,
    theme,
    cursorStyle,
    cursorBlink,
    optionAsAlt: platform === "darwin" ? optionAsAlt : "both",
  };
}

const run = promisify(execFile);

function ghosttyBinary(): string {
  const app = "/Applications/Ghostty.app/Contents/MacOS/ghostty";
  return process.platform === "darwin" && existsSync(app) ? app : "ghostty";
}

export async function loadGhosttyLook(env: NodeJS.ProcessEnv): Promise<LookResult> {
  try {
    const { stdout } = await run(ghosttyBinary(), ["+show-config"], { env, timeout: 5000, maxBuffer: 4 << 20 });
    return { kind: "loaded", look: parseShowConfig(stdout, process.platform) };
  } catch (error) {
    return {
      kind: "fallback",
      look: parseShowConfig("", process.platform),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
