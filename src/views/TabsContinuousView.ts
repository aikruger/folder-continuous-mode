import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  Notice,
} from "obsidian";
import { FileRenderer } from "../services/FileRenderer";
import { TabsManager } from "../services/TabsManager";
import { ScrollManager } from "../services/ScrollManager";
import { FileHighlighter } from "../services/FileHighlighter";

export const TABS_VIEW_TYPE = "tabs-continuous-view";

export class TabsContinuousView extends ItemView {
  private fileRenderer: FileRenderer | null = null;
  private tabsManager: TabsManager | null = null;
  private scrollManager: ScrollManager | null = null;
  private fileHighlighter: FileHighlighter | null = null;

  private tabsContainer: HTMLElement | null = null;
  private contentContainer: HTMLElement | null = null;

  private allFiles: TFile[] = [];
  private visibleFiles: TFile[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return TABS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `Continuous: Open Tabs (${this.visibleFiles.length})`;
  }

  async onOpen(): Promise<void> {
    console.log("TabsContinuousView.onOpen");

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("tabs-continuous-view");

    const tabsSection = root.createDiv("tabs-section");
    this.tabsContainer = tabsSection.createDiv("tabs-container");

    this.contentContainer = root.createDiv("content-area");
    this.contentContainer.addClass("scroll-container");

    this.fileRenderer = new FileRenderer(this.app);
    this.tabsManager = new TabsManager(this.app, this.tabsContainer);
    this.scrollManager = new ScrollManager(this.contentContainer, {
      maxFiles: 10,
      loadCount: 3,
      rootMargin: "100px 0px",
      threshold: 0.1,
    });
    this.fileHighlighter = new FileHighlighter(this.app);

    await this.loadInitialState();
    this.setupWorkspaceListeners();
    this.setupScrollListeners();

    console.log("TabsContinuousView initialized");
  }

  private async loadInitialState(): Promise<void> {
    const tabs = this.tabsManager!.getTabs();

    if (tabs.length === 0) {
      this.contentContainer!.setText("No open tabs");
      new Notice("No open tabs to show in continuous view");
      return;
    }

    this.allFiles = tabs.map((t) => t.file);
    this.visibleFiles = this.allFiles.slice(0, 5);

    await this.tabsManager!.updateTabs();
    await this.renderContent(this.visibleFiles);

    new Notice(`Loaded ${tabs.length} open files`);
  }

  private setupWorkspaceListeners(): void {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async () => {
        if (!this.tabsManager) return;
        await this.tabsManager.updateTabs();
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (!file || file.extension !== "md") return;
        if (!this.tabsManager) return;
        await this.tabsManager.updateTabs();
      })
    );

    this.tabsManager!.onTabChange((tab) => {
      // Optional: highlight matching file in continuous area when needed
      // For now, workspace handles focus, continuous view remains as is.
      console.log("TabsContinuousView: tab selected", tab.file.path);
    });
  }

  private setupScrollListeners(): void {
    this.scrollManager!.onLoadMore(async (direction) => {
      await this.onScrollLoadMore(direction);
    });
  }

  private async renderContent(files: TFile[]): Promise<void> {
    this.contentContainer!.empty();

    for (const file of files) {
      const element = await this.fileRenderer!.createFileElement(file);
      this.contentContainer!.appendChild(element);
    }

    console.log(`TabsContinuousView: rendered ${files.length} files`);
  }

  private async onScrollLoadMore(
    direction: "next" | "previous"
  ): Promise<void> {
    if (this.allFiles.length === 0) return;

    if (direction === "next") {
      const lastVisible = this.visibleFiles[this.visibleFiles.length - 1];
      const lastIndex = this.allFiles.findIndex(
        (f) => f.path === lastVisible.path
      );
      const start = lastIndex + 1;
      if (start >= this.allFiles.length) return;

      const newFiles = this.allFiles.slice(
        start,
        start + 3
      );
      for (const file of newFiles) {
        const el = await this.fileRenderer!.createFileElement(file);
        this.contentContainer!.appendChild(el);
      }
      this.visibleFiles.push(...newFiles);
    } else {
      const firstVisible = this.visibleFiles[0];
      const firstIndex = this.allFiles.findIndex(
        (f) => f.path === firstVisible.path
      );
      if (firstIndex <= 0) return;

      const start = Math.max(0, firstIndex - 3);
      const newFiles = this.allFiles.slice(start, firstIndex);
      for (const file of [...newFiles].reverse()) {
        const el = await this.fileRenderer!.createFileElement(file);
        this.contentContainer!.insertBefore(
          el,
          this.contentContainer!.firstChild
        );
      }
      this.visibleFiles.unshift(...newFiles);
    }
  }

  async onClose(): Promise<void> {
    console.log("TabsContinuousView.onClose");
    this.fileRenderer = null;
    this.tabsManager?.cleanup();
    this.scrollManager?.cleanup();
    this.fileHighlighter?.cleanup();
    this.tabsManager = null;
    this.scrollManager = null;
    this.fileHighlighter = null;
  }
}
