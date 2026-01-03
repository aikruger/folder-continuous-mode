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
        console.log("🟢 TabsContinuousView.onOpen");

        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass("tabs-continuous-view");

        // Single continuous content area (NO separate tabs bar)
        this.contentContainer = root.createDiv("content-area");
        this.contentContainer.addClass("scroll-container");

        this.fileRenderer = new FileRenderer(this.app);
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
        this.setupFileRemovalListener();

        console.log("✓ TabsContinuousView initialized");
    }

    private async loadInitialState(): Promise<void> {
        // Get all open markdown tabs
        const tabs = this.app.workspace.getLeavesOfType("markdown");
        const tabFiles = tabs
            .map((leaf: any) => leaf.view?.file)
            .filter((f: TFile | undefined) => f && f.extension === "md") as TFile[];

        if (tabFiles.length === 0) {
            this.contentContainer!.setText("No open markdown tabs");
            new Notice("No open tabs to show in continuous view");
            return;
        }

        this.allFiles = tabFiles;
        this.visibleFiles = this.allFiles.slice(0, 5);

        await this.renderContent(this.visibleFiles);

        new Notice(`Loaded ${tabFiles.length} open files`);
    }

    private setupWorkspaceListeners(): void {
        // When files open/close, refresh the all files list
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async () => {
                console.log("🔄 Tab changed, refreshing file list");
                const tabs = this.app.workspace.getLeavesOfType("markdown");
                const tabFiles = tabs
                    .map((leaf: any) => leaf.view?.file)
                    .filter(
                        (f: TFile | undefined) => f && f.extension === "md"
                    ) as TFile[];
                this.allFiles = tabFiles;

                // If removed files were in visible, refresh
                const stillVisible = this.visibleFiles.filter((f) =>
                    this.allFiles.some((af) => af.path === f.path)
                );
                if (stillVisible.length < this.visibleFiles.length) {
                    this.visibleFiles = stillVisible.slice(0, 5);
                    await this.renderContent(this.visibleFiles);
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (!file || file.extension !== "md") return;
                console.log("📂 File opened, refreshing");
                const tabs = this.app.workspace.getLeavesOfType("markdown");
                const tabFiles = tabs
                    .map((leaf: any) => leaf.view?.file)
                    .filter(
                        (f: TFile | undefined) => f && f.extension === "md"
                    ) as TFile[];
                this.allFiles = tabFiles;
            })
        );
    }

    private setupScrollListeners(): void {
        this.scrollManager!.onLoadMore(async (direction) => {
            await this.onScrollLoadMore(direction);
        });
    }

    private setupFileRemovalListener(): void {
        // Listen for close button clicks on file containers
        this.contentContainer!.addEventListener(
            "file-remove-requested",
            async (e: Event) => {
                const customEvent = e as CustomEvent;
                const file = customEvent.detail?.file as TFile;
                if (file) {
                    console.log(
                        `🗑️  TabsContinuousView: Removing ${file.basename}`
                    );
                    // Remove from allFiles
                    this.allFiles = this.allFiles.filter(
                        (f) => f.path !== file.path
                    );
                    this.visibleFiles = this.visibleFiles.filter(
                        (f) => f.path !== file.path
                    );
                    // Re-render
                    await this.renderContent(this.visibleFiles);
                }
            }
        );
    }

    private async renderContent(files: TFile[]): Promise<void> {
        this.contentContainer!.empty();

        if (files.length === 0) {
            this.contentContainer!.setText("No files in view");
            return;
        }

        for (const file of files) {
            const element = await this.fileRenderer!.createFileElement(file);
            this.contentContainer!.appendChild(element);
        }

        // Ensure sentinels are properly observed after DOM manipulation
        this.scrollManager!.ensureSentinelsObserved();

        console.log(`✓ TabsContinuousView: rendered ${files.length} files`);
    }

    private async onScrollLoadMore(
        direction: "next" | "previous"
    ): Promise<void> {
        if (this.allFiles.length === 0) {
            console.log("📜 No files to load");
            return;
        }

        console.log(
            `📜 ScrollManager triggered: ${direction}, visible: ${this.visibleFiles.length}, total: ${this.allFiles.length}`
        );

        if (direction === "next") {
            const lastVisibleFile =
                this.visibleFiles[this.visibleFiles.length - 1];
            const lastVisibleIndex = this.allFiles.findIndex(
                (f) => f.path === lastVisibleFile.path
            );

            const startIndex = lastVisibleIndex + 1;

            if (startIndex >= this.allFiles.length) {
                console.log("   → Already at end");
                return;
            }

            const newFiles = this.allFiles.slice(startIndex, startIndex + 3);
            console.log(
                `   → Loading ${newFiles.length} files next`
            );

            for (const file of newFiles) {
                const element = await this.fileRenderer!.createFileElement(file);
                this.contentContainer!.appendChild(element);
            }

            this.visibleFiles.push(...newFiles);
            console.log(`   ✓ Now showing ${this.visibleFiles.length} files`);
        } else {
            const firstVisibleFile = this.visibleFiles[0];
            const firstVisibleIndex = this.allFiles.findIndex(
                (f) => f.path === firstVisibleFile.path
            );

            if (firstVisibleIndex <= 0) {
                console.log("   → Already at start");
                return;
            }

            const loadCount = 3;
            const startIndex = Math.max(0, firstVisibleIndex - loadCount);
            const newFiles = this.allFiles.slice(startIndex, firstVisibleIndex);

            console.log(
                `   → Loading ${newFiles.length} files previous`
            );

            for (const file of newFiles.reverse()) {
                const element = await this.fileRenderer!.createFileElement(file);
                this.contentContainer!.insertBefore(
                    element,
                    this.contentContainer!.firstChild
                );
            }

            this.visibleFiles.unshift(...newFiles.reverse());
            console.log(`   ✓ Now showing ${this.visibleFiles.length} files`);
        }
    }

    async onClose(): Promise<void> {
        console.log("🔴 TabsContinuousView.onClose");
        this.fileRenderer = null;
        this.scrollManager?.cleanup();
        this.fileHighlighter?.cleanup();
        this.scrollManager = null;
        this.fileHighlighter = null;
    }
}
