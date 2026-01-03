import {
    ItemView,
    WorkspaceLeaf,
    TFile,
    Notice,
    App,
    MarkdownRenderer,
} from "obsidian";
import { FileRenderer } from "../services/FileRenderer";
import { ScrollManager } from "../services/ScrollManager";
import { FileHighlighter } from "../services/FileHighlighter";

export const CANVAS_VIEW_TYPE = "canvas-continuous-view";

export class CanvasContinuousView extends ItemView {
    private fileRenderer: FileRenderer | null = null;
    private scrollManager: ScrollManager | null = null;
    private fileHighlighter: FileHighlighter | null = null;

    private contentContainer: HTMLElement | null = null;

    private allCanvases: TFile[] = [];
    private visibleCanvases: TFile[] = [];

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return CANVAS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return `Continuous: Canvas Files (${this.visibleCanvases.length})`;
    }

    async onOpen(): Promise<void> {
        console.log("🟢 CanvasContinuousView.onOpen");

        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass("canvas-continuous-view");

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
        this.setupVaultListeners();
        this.setupScrollListeners();
        this.setupFileRemovalListener();

        console.log("✓ CanvasContinuousView initialized");
    }

    private async loadInitialState(): Promise<void> {
        const allCanvasFiles = this.app.vault
            .getFiles()
            .filter((f) => f.extension === "canvas");

        if (allCanvasFiles.length === 0) {
            this.contentContainer!.setText("No canvas files found");
            new Notice("No canvas files to display");
            return;
        }

        this.allCanvases = allCanvasFiles;
        this.visibleCanvases = this.allCanvases.slice(0, 5);

        await this.renderContent(this.visibleCanvases);

        new Notice(`Loaded ${allCanvasFiles.length} canvas files`);
    }

    private setupVaultListeners(): void {
        this.registerEvent(
            this.app.vault.on("create", (file) => {
                if (file instanceof TFile && file.extension === "canvas") {
                    console.log("🔄 Canvas created:", file.path);
                    this.allCanvases = this.app.vault
                        .getFiles()
                        .filter((f) => f.extension === "canvas");
                }
            })
        );

        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (file instanceof TFile && file.extension === "canvas") {
                    console.log("🔄 Canvas deleted:", file.path);
                    this.allCanvases = this.allCanvases.filter(
                        (f) => f.path !== file.path
                    );
                    this.visibleCanvases = this.visibleCanvases.filter(
                        (f) => f.path !== file.path
                    );
                    this.renderContent(this.visibleCanvases);
                }
            })
        );
    }

    private setupScrollListeners(): void {
        this.scrollManager!.onLoadMore(async (direction) => {
            await this.onScrollLoadMore(direction);
        });
    }

    private setupFileRemovalListener(): void {
        this.contentContainer!.addEventListener(
            "file-remove-requested",
            async (e: Event) => {
                const customEvent = e as CustomEvent;
                const file = customEvent.detail?.file as TFile;
                if (file) {
                    console.log(`🗑️  CanvasContinuousView: Removing ${file.path}`);
                    this.visibleCanvases = this.visibleCanvases.filter(
                        (f) => f.path !== file.path
                    );
                    await this.renderContent(this.visibleCanvases);
                }
            }
        );
    }

    private async renderContent(files: TFile[]): Promise<void> {
        this.contentContainer!.empty();

        if (files.length === 0) {
            this.contentContainer!.setText("No canvas files in view");
            return;
        }

        for (const file of files) {
            const element = await this.createCanvasElement(file);
            this.contentContainer!.appendChild(element);
        }

        this.scrollManager!.ensureSentinelsObserved();

        console.log(`✓ CanvasContinuousView: rendered ${files.length} canvases`);
    }

    private async createCanvasElement(file: TFile): Promise<HTMLElement> {
        const container = document.createElement("div");
        container.classList.add("file-container");
        container.classList.add("canvas-file-container");
        container.dataset.filePath = file.path;

        // Header with title + close button
        const header = container.createDiv("file-header");
        const titleGroup = header.createDiv("file-title-group");

        const title = titleGroup.createEl("h2", {
            text: file.basename,
            cls: "file-title",
        });
        title.style.cursor = "pointer";
        title.addEventListener("click", () => {
            this.app.workspace.getLeaf("tab").openFile(file);
        });

        // Close button
        const closeBtn = header.createEl("button", {
            cls: "file-close-btn",
            attr: { "aria-label": `Remove ${file.basename} from view` },
        });
        closeBtn.innerHTML = "×";
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            container.dispatchEvent(
                new CustomEvent("file-remove-requested", { detail: { file } })
            );
        });

        // Canvas preview (show JSON snippet)
        const preview = container.createDiv("file-content");
        preview.classList.add("canvas-preview");

        try {
            const content = await this.app.vault.read(file);
            const snippet = content.substring(0, 800);
            const codeBlock = preview.createEl("pre");
            codeBlock.createEl("code").setText(snippet);
        } catch (error) {
            preview.setText(
                `Error reading canvas: ${(error as Error)?.message ?? "unknown"}`
            );
        }

        return container;
    }

    private async onScrollLoadMore(
        direction: "next" | "previous"
    ): Promise<void> {
        if (this.allCanvases.length === 0) return;

        console.log(
            `📜 Canvas scroll: ${direction}, visible: ${this.visibleCanvases.length}, total: ${this.allCanvases.length}`
        );

        if (direction === "next") {
            const lastVisibleFile =
                this.visibleCanvases[this.visibleCanvases.length - 1];
            const lastVisibleIndex = this.allCanvases.findIndex(
                (f) => f.path === lastVisibleFile.path
            );

            const startIndex = lastVisibleIndex + 1;
            if (startIndex >= this.allCanvases.length) return;

            const newFiles = this.allCanvases.slice(startIndex, startIndex + 3);

            for (const file of newFiles) {
                const element = await this.createCanvasElement(file);
                this.contentContainer!.appendChild(element);
            }

            this.visibleCanvases.push(...newFiles);
        } else {
            const firstVisibleFile = this.visibleCanvases[0];
            const firstVisibleIndex = this.allCanvases.findIndex(
                (f) => f.path === firstVisibleFile.path
            );

            if (firstVisibleIndex <= 0) return;

            const loadCount = 3;
            const startIndex = Math.max(0, firstVisibleIndex - loadCount);
            const newFiles = this.allCanvases.slice(startIndex, firstVisibleIndex);

            for (const file of newFiles.reverse()) {
                const element = await this.createCanvasElement(file);
                this.contentContainer!.insertBefore(
                    element,
                    this.contentContainer!.firstChild
                );
            }

            this.visibleCanvases.unshift(...newFiles.reverse());
        }
    }

    async onClose(): Promise<void> {
        console.log("🔴 CanvasContinuousView.onClose");
        this.fileRenderer = null;
        this.scrollManager?.cleanup();
        this.fileHighlighter?.cleanup();
        this.scrollManager = null;
        this.fileHighlighter = null;
    }
}
