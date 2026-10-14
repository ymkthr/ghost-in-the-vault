import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Obsidian を起動した端末やマルチプレクサの痕跡。残すとシェルや TUI が zellij / tmux の中や Ghostty 本体で動いていると誤認する。 */
const INHERITED_TERMINAL_VARS = /^(ZELLIJ|GHOSTTY_|TERM_PROGRAM|TERMINFO$|TMUX)/;

/**
 * ログインシェルの環境変数を取得する。Dock や launcher から起動した Obsidian は
 * ログインシェルの PATH を持たず、Homebrew や Nix の python3 が見つからないため。
 */
export async function loadLoginEnv(): Promise<NodeJS.ProcessEnv> {
  const shell = userInfo().shell ?? process.env.SHELL ?? "/bin/sh";
  const base = await readLoginShellEnv(shell).catch(() => ({ ...process.env }));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!INHERITED_TERMINAL_VARS.test(key)) env[key] = value;
  }
  env.SHELL ??= shell;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

async function readLoginShellEnv(shell: string): Promise<NodeJS.ProcessEnv> {
  const { stdout } = await run(shell, ["-l", "-c", "env -0"], { timeout: 5000, maxBuffer: 4 << 20 });
  const env: NodeJS.ProcessEnv = {};
  for (const entry of stdout.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}
