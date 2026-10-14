import { type App, Plugin, PluginSettingTab, Setting, type WorkspaceLeaf } from "obsidian";
import { loadLoginEnv } from "./login-env.ts";
import { TerminalView, VIEW_TYPE } from "./view.ts";

const LOCATIONS = {
  split: "ノートの下に分割",
  tab: "新しいタブ",
  right: "右サイドバー",
} as const;

type Location = keyof typeof LOCATIONS;

const isLocation = (value: string): value is Location => value in LOCATIONS;

const SIDES = ["top", "right", "bottom", "left"] as const;

type PaddingSide = (typeof SIDES)[number];

const PADDING_SIDES: Record<PaddingSide, string> = { top: "上", right: "右", bottom: "下", left: "左" };

interface Settings {
  location: Location;
  /** ターミナル外周の余白 (px) */
  padding: Record<PaddingSide, number>;
  /** シェルが起動するたびに実行するコマンド。空なら何もしない */
  startupCommand: string;
}

const DEFAULT_SETTINGS: Settings = { location: "split", padding: { top: 2, right: 2, bottom: 2, left: 2 }, startupCommand: "" };

const parsePadding = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

export default class GhostInTheVaultPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private loginEnv?: Promise<NodeJS.ProcessEnv>;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = parseSettings(saved);
    this.applyPadding();

    this.registerView(
      VIEW_TYPE,
      (leaf) =>
        new TerminalView(leaf, {
          loginEnv: () => (this.loginEnv ??= loadLoginEnv()),
          startupCommand: () => this.settings.startupCommand,
        }),
    );
    this.addRibbonIcon("terminal", "ターミナルを開く", () => this.reveal());
    this.addCommand({ id: "open", name: "ターミナルを開く", callback: () => this.reveal() });
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  onunload(): void {
    for (const side of SIDES) document.body.style.removeProperty(`--gitv-padding-${side}`);
  }

  /** 余白は CSS 変数で渡す。開いているターミナルにもすぐ効き、入れ物の大きさの変化で行数・列数も合わせ直される。 */
  applyPadding(): void {
    for (const side of SIDES) document.body.style.setProperty(`--gitv-padding-${side}`, `${this.settings.padding[side]}px`);
  }

  private async reveal(): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? (await this.newLeaf());
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  }

  private async newLeaf(): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    switch (this.settings.location) {
      case "split":
        return workspace.getLeaf("split", "horizontal");
      case "tab":
        return workspace.getLeaf("tab");
      case "right":
        return workspace.getRightLeaf(false) ?? workspace.getLeaf("tab");
      default: {
        const _exhaustive: never = this.settings.location;
        return _exhaustive;
      }
    }
  }
}

function parseSettings(saved: unknown): Settings {
  if (typeof saved !== "object" || saved === null) return structuredClone(DEFAULT_SETTINGS);
  const location = "location" in saved && typeof saved.location === "string" && isLocation(saved.location) ? saved.location : DEFAULT_SETTINGS.location;
  const padding = { ...DEFAULT_SETTINGS.padding };
  if ("padding" in saved && typeof saved.padding === "object" && saved.padding !== null) {
    for (const side of SIDES) {
      const value = side in saved.padding ? parsePadding(Reflect.get(saved.padding, side)) : null;
      if (value !== null) padding[side] = value;
    }
  }
  const startupCommand = "startupCommand" in saved && typeof saved.startupCommand === "string" ? saved.startupCommand.trim() : "";
  return { location, padding, startupCommand };
}

class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: GhostInTheVaultPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl, plugin } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("開く場所")
      .setDesc("ターミナルがまだ開いていないときに作る場所。")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(LOCATIONS)
          .setValue(plugin.settings.location)
          .onChange(async (value) => {
            if (!isLocation(value)) return;
            plugin.settings.location = value;
            await plugin.saveData(plugin.settings);
          }),
      );

    new Setting(containerEl)
      .setName("起動時のコマンド")
      .setDesc("ターミナルを開いたとき (Enter でシェルを再起動したときも) に、プロンプトが出てから自動で実行する。空ならシェルが立ち上がるだけ。")
      .addText((text) =>
        text
          .setPlaceholder("例: claude")
          .setValue(plugin.settings.startupCommand)
          .onChange(async (value) => {
            plugin.settings.startupCommand = value.trim();
            await plugin.saveData(plugin.settings);
          }),
      );

    for (const side of SIDES) {
      new Setting(containerEl)
        .setName(`余白 (${PADDING_SIDES[side]})`)
        .setDesc("ターミナル外周の余白。単位は px。")
        .addText((text) => {
          text.inputEl.type = "number";
          text.inputEl.min = "0";
          text.setValue(String(plugin.settings.padding[side])).onChange(async (value) => {
            const parsed = value.trim() === "" ? null : parsePadding(Number(value));
            if (parsed === null) return;
            plugin.settings.padding[side] = parsed;
            plugin.applyPadding();
            await plugin.saveData(plugin.settings);
          });
        });
    }
  }
}
