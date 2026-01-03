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

    private activeEditorFile: string | null = null; // Track which file is currently being edited

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

        // Enable double-click to edit files inline in continuous view
        this.setupDoubleClickEditing();

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
        /**
         * Use event delegation to handle close button clicks.
         * This is more efficient than attaching listeners to each button.
         */
        this.contentContainer!.addEventListener(
            'click',
            async (e: Event) => {
                const target = e.target as HTMLElement;

                // Only respond to clicks on close buttons
                if (!target.classList.contains('file-close-btn')) return;

                e.stopPropagation();
                e.preventDefault();

                // Walk up DOM to find the file-container
                const container = target.closest('.file-container') as HTMLElement | null;
                if (!container) return;

                const filePath = container.dataset.filePath;
                if (!filePath) return;

                console.log(`🗑️  TabsContinuousView: Close button clicked on ${filePath}`);

                // Remove from visibleFiles array
                this.visibleFiles = this.visibleFiles.filter(f => f.path !== filePath);

                // Remove container from DOM
                container.remove();

                // Update view title with new count
                this.updateViewTitle();

                console.log(`✓ File removed from view. Now showing ${this.visibleFiles.length} files`);
            },
            { capture: false }
        );
    }

    private updateViewTitle(): void {
        /**
         * Update the view title to show current file count.
         * This is called after files are added/removed.
         */
        const displayText = `Continuous: Open Tabs (${this.visibleFiles.length})`;
        // Helper to update title in leaf header
        // Since getDisplayText uses this.visibleFiles.length, we might need to trigger update
        // But the instruction says querySelector view-header-title
        const titleEl = this.containerEl.closest('.workspace-leaf')?.querySelector('.view-header-title');
        if (titleEl) {
            titleEl.textContent = displayText;
        }
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

            this.scrollManager!.ensureSentinelsObserved();
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

            this.scrollManager!.ensureSentinelsObserved();
            this.visibleFiles.unshift(...newFiles.reverse());
            console.log(`   ✓ Now showing ${this.visibleFiles.length} files`);
        }
    }

    private setupDoubleClickEditing(): void {
        /**
         * Delegate double-click events from file content to activate inline editing.
         * This allows users to edit files directly in continuous view without opening separate editor.
         */
        this.contentContainer!.addEventListener('dblclick', async (e: Event) => {
            const target = e.target as HTMLElement;

            // Walk up DOM tree to find the file-container that was double-clicked
            let container = target.closest('.file-container') as HTMLElement | null;
            if (!container) return;

            const filePath = container.dataset.filePath;
            if (!filePath) return;

            // Get the file object from vault
            const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
            if (!file) return;

            // Only allow editing markdown files
            if (file.extension !== 'md') return;

            console.log(`✏️  TabsContinuousView: Double-click detected on ${file.basename}`);

            // Find the file-content div and activate inline editor
            const fileContentDiv = container.querySelector('.file-content') as HTMLElement;
            if (!fileContentDiv) return;

            await this.activateInlineEditor(file, fileContentDiv, container);
        });
    }

    private async activateInlineEditor(file: TFile, contentDiv: HTMLElement, container: HTMLElement): Promise<void> {
        if (this.activeEditorFile !== file.path) {
            this.activeEditorFile = file.path;
            container.addClass("editing-active");

            try {
                // Read current file content
                let fileContent = await this.app.vault.read(file);

                // Create editor container
                let editorContainer = contentDiv.createDiv("fallback-editor-container");
                let textarea = editorContainer.createEl("textarea", {
                    cls: "fallback-inline-editor",
                    value: fileContent
                });

                // Focus and select all text
                textarea.focus();
                textarea.select();

                // Create overlay to handle clicks outside
                let overlay = document.createElement("div");
                overlay.classList.add("focus-trap-overlay");
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 999998;
                    background: transparent;
                `;
                document.body.appendChild(overlay);

                // Define save handler
                let saveFile = async () => {
                    try {
                        let newContent = textarea.value;
                        await this.app.vault.modify(file, newContent);
                        console.log(`✓ TabsContinuousView: Saved ${file.basename}`);

                        // Clean up editor
                        editorContainer.remove();
                        overlay.remove();
                        container.removeClass("editing-active");
                        this.activeEditorFile = null;

                        // Re-render file content
                        contentDiv.empty();
                        await this.fileRenderer!.renderFileContent(file, contentDiv);
                    } catch (error) {
                        console.error("Error saving file:", error);
                        new Notice(`Failed to save ${file.basename}: ${(error as Error).message}`);
                    }
                };

                // Define cancel handler
                let cancelEdit = () => {
                    console.log(`✓ TabsContinuousView: Edit cancelled`);
                    editorContainer.remove();
                    overlay.remove();
                    container.removeClass("editing-active");
                    this.activeEditorFile = null;
                    contentDiv.empty();
                    this.fileRenderer!.renderFileContent(file, contentDiv);
                };

                // Key handler for Ctrl+Enter and Escape
                let onKeyDown = async (event: KeyboardEvent) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        await saveFile();
                        return;
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelEdit();
                        return;
                    }
                };

                // Click handler for overlay (click outside to save)
                let onOverlayClick = async (event: MouseEvent) => {
                    if (event.target === overlay) {
                        event.preventDefault();
                        event.stopPropagation();
                        await saveFile();
                    }
                };

                // Attach event listeners
                textarea.addEventListener("keydown", onKeyDown);
                overlay.addEventListener("click", onOverlayClick);

            } catch (error) {
                console.error(`Error activating editor for ${file.basename}:`, error);
                new Notice(`Failed to open editor: ${(error as Error).message}`);
                container.removeClass("editing-active");
                this.activeEditorFile = null;
            }
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
