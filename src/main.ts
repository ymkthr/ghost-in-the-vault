import { type App, Plugin, PluginSettingTab, Setting, type WorkspaceLeaf } from "obsidian";
import { loadLoginEnv } from "./login-env.ts";
import { VIEW_TYPE, ZellijTerminalView } from "./view.ts";

const LOCATIONS = {
  split: "ノートの下に分割",
  tab: "新しいタブ",
  right: "右サイドバー",
} as const;

type Location = keyof typeof LOCATIONS;

const isLocation = (value: string): value is Location => value in LOCATIONS;

interface Settings {
  sessionName: string;
  location: Location;
}

const DEFAULT_SETTINGS: Settings = { sessionName: "obsidian", location: "split" };

export default class GhosttyZellijPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private loginEnv?: Promise<NodeJS.ProcessEnv>;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = parseSettings(saved);

    this.registerView(
      VIEW_TYPE,
      (leaf) =>
        new ZellijTerminalView(leaf, {
          sessionName: () => this.settings.sessionName,
          loginEnv: () => (this.loginEnv ??= loadLoginEnv()),
        }),
    );
    this.addRibbonIcon("terminal", "zellij ターミナルを開く", () => this.reveal());
    this.addCommand({ id: "open", name: "zellij ターミナルを開く", callback: () => this.reveal() });
    this.addSettingTab(new SettingsTab(this.app, this));
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
  if (typeof saved !== "object" || saved === null) return { ...DEFAULT_SETTINGS };
  const sessionName = "sessionName" in saved && typeof saved.sessionName === "string" ? saved.sessionName.trim() : "";
  const location = "location" in saved && typeof saved.location === "string" && isLocation(saved.location) ? saved.location : DEFAULT_SETTINGS.location;
  return { sessionName: sessionName || DEFAULT_SETTINGS.sessionName, location };
}

class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: GhosttyZellijPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl, plugin } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("zellij セッション名")
      .setDesc("このセッションに attach する。無ければ作る。次に開いたときから反映。")
      .addText((text) =>
        text.setValue(plugin.settings.sessionName).onChange(async (value) => {
          plugin.settings.sessionName = value.trim() || DEFAULT_SETTINGS.sessionName;
          await plugin.saveData(plugin.settings);
        }),
      );

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
  }
}
