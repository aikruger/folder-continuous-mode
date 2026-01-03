import {
  App,
  WorkspaceLeaf,
  WorkspaceSplit,
  WorkspaceTabs,
  MarkdownView,
  TFile,
} from "obsidian";
import { TabInfo, TabChangeCallback } from "../types";

export class TabsManager {
  private tabElements = new Map<string, HTMLElement>();
  private onTabChangeCallback: TabChangeCallback | null = null;

  constructor(private app: App, private tabsContainer: HTMLElement) {}

  getTabs(): TabInfo[] {
    const tabs: TabInfo[] = [];

    const traverseContainer = (container: any) => {
      if (!container || !container.children) return;

      for (const child of container.children) {
        if (child.view && child.view instanceof MarkdownView) {
          const file = child.view.file;
          if (file && file.extension === "md") {
            tabs.push({
              file,
              leaf: child as WorkspaceLeaf,
              isActive: child === this.app.workspace.activeLeaf,
              title: file.basename,
            });
          }
        } else if (
          child instanceof WorkspaceSplit ||
          child instanceof WorkspaceTabs
        ) {
          traverseContainer(child);
        }
      }
    };

    traverseContainer(this.app.workspace.rootSplit);
    return tabs;
  }

  async updateTabs(): Promise<void> {
    const tabs = this.getTabs();

    this.tabsContainer.empty();
    this.tabElements.clear();

    if (tabs.length === 0) {
      this.tabsContainer.createEl("p", {
        text: "No open tabs",
        cls: "no-tabs-message",
      });
      return;
    }

    for (const tab of tabs) {
      const tabEl = this.createTabElement(tab);
      this.tabsContainer.appendChild(tabEl);
      this.tabElements.set(tab.file.path, tabEl);
    }

    console.log(`TabsManager: rendered ${tabs.length} tabs`);
  }

  private createTabElement(tab: TabInfo): HTMLElement {
    const el = document.createElement("div");
    el.classList.add("tab-item");
    if (tab.isActive) el.classList.add("tab-item-active");
    el.dataset.filePath = tab.file.path;

    const title = el.createDiv("tab-title");
    title.setText(tab.file.basename);

    const closeBtn = el.createEl("button", {
      cls: "tab-close-button",
      attr: { "aria-label": `Close ${tab.file.basename}` },
    });
    closeBtn.innerHTML = "×";

    el.addEventListener("click", (e) => {
      if (e.target !== closeBtn) {
        this.focusTab(tab);
      }
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeTab(tab.file);
    });

    return el;
  }

  private focusTab(tab: TabInfo): void {
    this.app.workspace.revealLeaf(tab.leaf);
    this.app.workspace.setActiveLeaf(tab.leaf, { focus: true });
    if (this.onTabChangeCallback) {
      this.onTabChangeCallback(tab);
    }
  }

  private async closeTab(file: TFile): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === file.path
      ) {
        leaf.detach();
        await this.updateTabs();
        return;
      }
    }
  }

  onTabChange(callback: TabChangeCallback): void {
    this.onTabChangeCallback = callback;
  }

  cleanup(): void {
    this.tabsContainer.empty();
    this.tabElements.clear();
    this.onTabChangeCallback = null;
  }
}
