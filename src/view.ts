import { FitAddon, Terminal, init } from "ghostty-web";
import { FileSystemAdapter, ItemView, Notice, Scope, type WorkspaceLeaf } from "obsidian";
import { type OptionAsAlt, loadGhosttyLook } from "./ghostty-look.ts";
import { type KeyLayout, createKittyFlagsTracker, encodeTextKey, loadKeyLayout } from "./keys.ts";
import { attachMouseReporting } from "./mouse.ts";
import { createOsc52Sniffer } from "./osc52.ts";
import { type Pty, type PtyExit, spawnPty } from "./pty.ts";

export const VIEW_TYPE = "ghost-in-the-vault";

type Session = { kind: "running"; pty: Pty; kittyFlags: () => number } | { kind: "exited" };

type HeldOption = "AltLeft" | "AltRight" | null;

const OPTION_COMPOSES: Record<OptionAsAlt, (held: HeldOption) => boolean> = {
  none: () => true,
  both: () => false,
  left: (held) => held === "AltRight",
  right: (held) => held === "AltLeft",
};

const MODIFIERS_TERMINAL_OWNS_WITHOUT_CMD = [[], ["Ctrl"], ["Alt"], ["Shift"], ["Ctrl", "Alt"], ["Ctrl", "Shift"], ["Alt", "Shift"], ["Ctrl", "Alt", "Shift"]] as const;

const latin1 = new TextDecoder("latin1");

export class TerminalView extends ItemView {
  private session: Session = { kind: "exited" };
  private teardown: (() => void)[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly loginEnv: () => Promise<NodeJS.ProcessEnv>,
  ) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    for (const modifiers of MODIFIERS_TERMINAL_OWNS_WITHOUT_CMD) this.scope.register([...modifiers], null, () => true);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ターミナル";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen(): Promise<void> {
    const [env, layout] = await Promise.all([this.loginEnv(), loadKeyLayout(), init()]);
    const result = await loadGhosttyLook(env);
    if (result.kind === "fallback") new Notice(`Ghostty の設定を読めなかったため既定の見た目で開きます: ${result.reason}`);
    const { look } = result;

    this.contentEl.empty();
    this.contentEl.addClass("gz-view");
    this.contentEl.style.backgroundColor = look.theme.background ?? "";
    // Why not styles.css: テーマ (Cupertino など) がサイドバーの .view-content の padding をより高い詳細度で上書きする。
    // インラインの important ならどのテーマのスタイルシートにも負けない。値は設定画面が body に置く CSS 変数。
    this.contentEl.style.setProperty(
      "padding",
      "var(--gitv-padding-top, 2px) var(--gitv-padding-right, 2px) var(--gitv-padding-bottom, 2px) var(--gitv-padding-left, 2px)",
      "important",
    );
    const host = this.contentEl.createDiv({ cls: "gz-host" });

    const term = new Terminal({
      fontFamily: look.fontFamily,
      fontSize: look.fontSize,
      theme: look.theme,
      cursorStyle: look.cursorStyle,
      cursorBlink: look.cursorBlink,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    // Obsidian は aria-label を持つ要素にホバーでツールチップを出すため、端末の上に "Terminal input" が出続ける。
    host.removeAttribute("aria-label");
    fit.fit();
    fit.observeResize();

    const send = (data: string) => {
      if (this.session.kind === "running") this.session.pty.write(data);
    };
    const start = () => {
      const copy = createOsc52Sniffer((text) => void navigator.clipboard.writeText(text));
      const kitty = createKittyFlagsTracker();
      this.session = {
        kind: "running",
        kittyFlags: kitty.flags,
        pty: spawnPty({
          command: [env.SHELL ?? "/bin/sh", "-l"],
          cwd: this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : process.cwd(),
          env,
          size: { cols: term.cols, rows: term.rows },
          onData: (chunk) => {
            const text = latin1.decode(chunk);
            copy(text);
            kitty.feed(text);
            term.write(chunk);
          },
          onExit: (exit) => {
            this.session = { kind: "exited" };
            term.write(`\r\n\x1b[2m[${describeExit(exit)}。Enter で再起動]\x1b[0m\r\n`);
          },
        }),
      };
    };

    const onData = term.onData((data) => {
      if (this.session.kind === "exited" && data === "\r") start();
      else send(data);
    });
    const onResize = term.onResize((size) => {
      if (this.session.kind === "running") this.session.pty.resize(size);
    });
    const detachInput = attachInputRouting({
      root: this.contentEl,
      term,
      optionAsAlt: look.optionAsAlt,
      layout,
      kittyFlags: () => (this.session.kind === "running" ? this.session.kittyFlags() : 0),
      send,
    });
    const detachMouse = attachMouseReporting(term, host, send);

    this.teardown = [
      () => {
        if (this.session.kind === "running") this.session.pty.kill();
        this.session = { kind: "exited" };
      },
      detachMouse,
      detachInput,
      () => onData.dispose(),
      () => onResize.dispose(),
      () => fit.dispose(),
      () => term.dispose(),
    ];

    start();
    term.focus();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) term.focus();
      }),
    );
  }

  async onClose(): Promise<void> {
    for (const dispose of this.teardown) dispose();
    this.teardown = [];
  }
}

function describeExit(exit: PtyExit): string {
  switch (exit.kind) {
    case "exited":
      return exit.code === 0 ? "シェルが終了しました" : `シェルが終了しました (code ${exit.code ?? "signal"})`;
    case "failed":
      return `起動に失敗しました: ${exit.message}`;
    default: {
      const _exhaustive: never = exit;
      return _exhaustive;
    }
  }
}

/**
 * ghostty-web の入力処理より先に (capture で) 打鍵やペーストを振り分ける。
 * - Cmd の組み合わせは端末へ送らない (Obsidian のホットキーやコピー/ペーストに使う)。
 * - Ghostty の macos-option-as-alt で Alt 扱いにならない側の Option は、macOS の文字合成をそのまま入力する。
 * - Ctrl / Alt 付きの文字キーは自前で符号化する。ghostty-web 0.4.0 は macOS の Option 合成文字で
 *   何も送らず、Ctrl+Alt+文字は修飾を落として送り、kitty keyboard protocol にも従わないため。
 * - ペーストは Terminal.paste に渡す。ghostty-web の paste イベント処理は bracketed paste を無視するため。
 * - フォーカスの出入りを、アプリが要求していれば (DECSET 1004) 通知する。ghostty-web は送らない。
 * 矢印やファンクションキーなど文字を持たないキーは ghostty-web に任せる。
 */
function attachInputRouting(args: {
  root: HTMLElement;
  term: Terminal;
  optionAsAlt: OptionAsAlt;
  layout: KeyLayout;
  kittyFlags: () => number;
  send: (data: string) => void;
}): () => void {
  const { root, term, layout, send } = args;
  const composes = OPTION_COMPOSES[args.optionAsAlt];
  let held: HeldOption = null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.code === "AltLeft" || e.code === "AltRight") held = e.code;
    if (e.metaKey) {
      if (e.code !== "KeyC" && e.code !== "KeyV") e.stopPropagation();
      return;
    }
    const alt = e.altKey && !composes(held);
    if (e.altKey && !alt && !e.ctrlKey) {
      if (e.key.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        send(e.key);
      } else if (e.key === "Dead") {
        // デッドキーは後続の composition イベントで確定文字が届くので、keydown だけ止める。
        e.stopPropagation();
      }
      return;
    }
    if (!alt && !e.ctrlKey) return;
    const kittyFlags = args.kittyFlags();
    // Ctrl のみの従来形式 (^C など) は ghostty-web の符号化で正しい。
    if (!alt && kittyFlags === 0) return;
    const base = layout.get(e.code);
    if (!base) return;
    const plain = e.key.length === 1 && e.key.charCodeAt(0) < 0x7f;
    const text = /^[a-z]$/.test(base) ? (e.shiftKey ? base.toUpperCase() : base) : plain && !e.ctrlKey ? e.key : base;
    e.preventDefault();
    e.stopPropagation();
    send(encodeTextKey({ base, text, shift: e.shiftKey, alt, ctrl: e.ctrlKey }, kittyFlags));
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === held) held = null;
  };
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    term.paste(text);
  };
  const onFocusIn = () => {
    if (term.hasFocusEvents()) send("\x1b[I");
  };
  const onFocusOut = () => {
    held = null;
    if (term.hasFocusEvents()) send("\x1b[O");
  };

  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("keyup", onKeyUp, true);
  root.addEventListener("paste", onPaste, true);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  return () => {
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("keyup", onKeyUp, true);
    root.removeEventListener("paste", onPaste, true);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
  };
}
