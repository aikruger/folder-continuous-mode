import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import EnhancedContinuousModePlugin from '../main';

export const CANVAS_VIEW_TYPE = "canvas-continuous-view";

export class CanvasContinuousView extends ItemView {
    private plugin: EnhancedContinuousModePlugin;
    private allFiles: TFile[] = [];
    private loadedFiles: TFile[] = [];
    private currentIndex = 0;

    private topSentinel: HTMLElement;
    private bottomSentinel: HTMLElement;
    private topIndicator: HTMLElement;
    private bottomIndicator: HTMLElement;
    private intersectionObserver: IntersectionObserver;
    private contentContainer: HTMLElement;
    private activeFileObserver: IntersectionObserver;
    private lastHighlighted: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: EnhancedContinuousModePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.setupIntersectionObserver();
    }

    getViewType(): string {
        return CANVAS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return `Continuous: Canvas Files (${this.allFiles.length})`;
    }

    async onOpen() {
        console.log("🟢 CanvasContinuousView.onOpen");
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('enhanced-continuous-container');
        container.addClass('canvas-continuous-view');

        this.createScrollElements(container);
        this.setupActiveFileObserver();

        await this.loadInitialState();
        this.setupVaultListeners();
    }

    async onClose() {
        try {
            if (this.intersectionObserver) {
                this.intersectionObserver.disconnect();
                this.intersectionObserver = new IntersectionObserver(() => {});
                this.intersectionObserver.disconnect();
            }
            if (this.activeFileObserver) {
                this.activeFileObserver.disconnect();
                this.activeFileObserver = new IntersectionObserver(() => {});
                this.activeFileObserver.disconnect();
            }

            if (this.lastHighlighted) {
                this.lastHighlighted.removeClass('is-active-in-continuous-view');
                this.lastHighlighted = null;
            }

            this.loadedFiles = [];
            this.allFiles = [];
            this.currentIndex = 0;

            if (this.contentContainer) {
                this.contentContainer.empty();
                this.contentContainer = createDiv();
            }
        } catch (error) {
            console.error('View closure cleanup error:', error);
        }
    }

    private async loadInitialState(): Promise<void> {
        this.allFiles = this.app.vault.getFiles().filter(f => f.extension === 'canvas');

        if (this.allFiles.length === 0) {
            this.contentContainer!.setText("No canvas files found");
            new Notice("No canvas files to display");
            return;
        }

        await this.loadInitialFiles();
        new Notice(`Loaded ${this.allFiles.length} canvas files`);
    }

    private setupVaultListeners(): void {
        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (file instanceof TFile && file.extension === "canvas") {
                    this.allFiles = this.app.vault.getFiles().filter(f => f.extension === 'canvas');
                    await this.loadInitialFiles(); // Reload list
                }
            })
        );

        this.registerEvent(
            this.app.vault.on("delete", async (file) => {
                if (file instanceof TFile && file.extension === "canvas") {
                    this.allFiles = this.allFiles.filter(f => f.path !== file.path);
                    this.loadedFiles = this.loadedFiles.filter(f => f.path !== file.path);
                    this.removeFileFromDOM(file.path);
                    this.updateScrollElements();
                }
            })
        );
    }

    // Copied and adapted methods

    private debounce(func: Function, wait: number) {
        let timeout: NodeJS.Timeout;
        return (...args: any[]) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    private loadNextFilesDebounced = this.debounce(this.loadNextFiles.bind(this), 200);
    private loadPreviousFilesDebounced = this.debounce(this.loadPreviousFiles.bind(this), 200);

    public setupIntersectionObserver() {
        let options = {
            root: this.containerEl.children[1],
            rootMargin: "50px 0px",
            threshold: 0.1
        };

        this.intersectionObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (entry.target === this.topSentinel && this.currentIndex > 0) {
                        this.loadPreviousFilesDebounced();
                    }
                    if (entry.target === this.bottomSentinel) {
                        this.loadNextFilesDebounced();
                    }
                }
            });
        }, options);
    }

    private setupActiveFileObserver() {
        const options = {
            root: null,
            rootMargin: "0px 0px -40% 0px",
            threshold: [0.1, 0.3, 0.5, 0.7]
        };

        this.activeFileObserver = new IntersectionObserver((entries) => {
            let mostVisible: Element | null = null;
            let maxRatio = 0;

            entries.forEach(entry => {
                if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
                    maxRatio = entry.intersectionRatio;
                    mostVisible = entry.target;
                }
            });

            if (mostVisible) {
                const el = mostVisible as HTMLElement;
                setTimeout(() => {
                    if (el && el.dataset.fileName) {
                        this.highlightFileInExplorer(el);
                    }
                }, 50);
            }
        }, options);
    }

    private highlightFileInExplorer(element: HTMLElement) {
        const fileName = element.dataset.fileName;
        if (!fileName) return;

        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('is-active-in-continuous-view');
            this.lastHighlighted = null;
        }

        const findAndHighlight = (attempt = 0) => {
            const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')?.[0];
            if (!explorerLeaf) {
                if (attempt < 3) setTimeout(() => findAndHighlight(attempt + 1), 200);
                return;
            }

            const selectors = [
                `.nav-file-title[data-path="${fileName}"]`,
                `[data-path="${fileName}"]`
            ];

            let navElement: HTMLElement | null = null;
            for (const selector of selectors) {
                try {
                    const found = explorerLeaf.view.containerEl.querySelector(selector) as HTMLElement | null;
                    if (found) {
                        navElement = found;
                        break;
                    }
                } catch (e) {}
            }

            if (navElement) {
                navElement.addClass('is-active-in-continuous-view');
                this.lastHighlighted = navElement;
            }
        };

        findAndHighlight();
    }

    private async loadInitialFiles() {
        const fileCount = Math.min(this.plugin.settings.initialFileCount, this.allFiles.length);
        this.currentIndex = 0;
        this.loadedFiles = this.allFiles.slice(0, fileCount);

        await this.renderFiles();
        this.updateScrollElements();

        setTimeout(() => {
            if (!this.validateObservers()) {
                this.setupIntersectionObserver();
                this.setupActiveFileObserver();
                this.updateScrollElements();
            }
        }, 300);
    }

    private validateObservers(): boolean {
        return !!(this.intersectionObserver && this.activeFileObserver && this.topSentinel && this.bottomSentinel && this.contentContainer);
    }

    private async loadNextFiles() {
        const totalLoadedFromStart = this.currentIndex + this.loadedFiles.length;
        if (totalLoadedFromStart >= this.allFiles.length) return;

        const loadCount = this.plugin.settings.loadUnloadCount;
        const startIndex = totalLoadedFromStart;
        const endIndex = Math.min(startIndex + loadCount, this.allFiles.length);
        const filesToLoad = this.allFiles.slice(startIndex, endIndex);

        if (filesToLoad.length === 0) return;

        const currentCapacity = this.loadedFiles.length;
        const maxCapacity = this.plugin.settings.maxFileCount;

        if (currentCapacity + filesToLoad.length > maxCapacity) {
            const removeCount = Math.min(
                this.plugin.settings.loadUnloadCount,
                currentCapacity + filesToLoad.length - maxCapacity
            );
            const filesToRemove = this.loadedFiles.splice(0, removeCount);
            this.removeFilesFromDOM(filesToRemove);
            this.currentIndex += removeCount;
        }

        await this.appendFilesToDOM(filesToLoad);
        this.loadedFiles.push(...filesToLoad);
        this.updateScrollElements();
    }

    private async loadPreviousFiles() {
        if (this.currentIndex === 0) return;

        const loadCount = this.plugin.settings.loadUnloadCount;
        const newIndex = Math.max(0, this.currentIndex - loadCount);
        const filesToLoad = this.allFiles.slice(newIndex, this.currentIndex);

        if (filesToLoad.length === 0) return;

        const currentCapacity = this.loadedFiles.length;
        const maxCapacity = this.plugin.settings.maxFileCount;

        if (currentCapacity + filesToLoad.length > maxCapacity) {
            const removeCount = Math.min(
                this.plugin.settings.loadUnloadCount,
                currentCapacity + filesToLoad.length - maxCapacity
            );
            const filesToRemove = this.loadedFiles.splice(this.loadedFiles.length - removeCount, removeCount);
            this.removeFilesFromDOM(filesToRemove);
        }

        this.currentIndex = newIndex;
        await this.prependFilesToDOM(filesToLoad);
        this.loadedFiles.unshift(...filesToLoad);
        this.updateScrollElements();
    }

    private async renderFiles() {
        this.contentContainer.empty();
        await this.appendFilesToDOM(this.loadedFiles);
    }

    private async renderFileContent(file: TFile, container: HTMLElement): Promise<void> {
        container.empty();
        const preview = container.createDiv('canvas-preview');
        try {
            const content = await this.app.vault.read(file);
            const snippet = content.substring(0, 800);
            const codeBlock = preview.createEl("pre");
            codeBlock.createEl("code").setText(snippet);
        } catch (error) {
            preview.setText(`Error reading canvas: ${(error as Error)?.message ?? "unknown"}`);
        }
    }

    private async createFileElement(file: TFile): Promise<HTMLElement> {
        const container = document.createElement('div');
        container.classList.add('file-container');
        container.classList.add('canvas-file-container');
        container.dataset.fileName = file.path;

        const header = container.createDiv('file-header');
        const titleGroup = header.createDiv('file-title-group');
        const title = titleGroup.createEl('h2', {
            text: file.basename,
            cls: 'file-title'
        });

        title.style.cursor = 'pointer';
        title.addEventListener('click', () => {
            this.app.workspace.getLeaf('tab').openFile(file);
        });

        const closeBtn = header.createEl('button', {
            cls: 'file-close-btn',
            attr: { 'aria-label': `Remove ${file.basename} from view` }
        });
        closeBtn.innerHTML = '×';
        closeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();

            this.loadedFiles = this.loadedFiles.filter(f => f.path !== file.path);
            this.allFiles = this.allFiles.filter(f => f.path !== file.path);

            container.remove();

            if (this.activeFileObserver) {
                this.activeFileObserver.unobserve(container);
            }

            this.leaf.view.containerEl.querySelector('.view-header-title')!.textContent = this.getDisplayText();
        });

        const content = container.createDiv('file-content');
        await this.renderFileContent(file, content);

        console.debug(`Created element for file: ${file.path}`);
        return container;
    }

    private async appendFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        for (const file of files) {
            const element = await this.createFileElement(file);
            fragment.appendChild(element);
        }
        this.contentContainer.appendChild(fragment);
        setTimeout(() => {
            files.forEach(file => {
                const element = this.contentContainer.querySelector(`[data-file-name="${file.path}"]`);
                if (element) {
                    this.activeFileObserver.observe(element);
                }
            });
        }, 100);
    }

    private async prependFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        for (const file of files.reverse()) {
            const element = await this.createFileElement(file);
            fragment.prepend(element);
        }
        this.contentContainer.prepend(fragment);
        files.forEach(file => {
            const element = this.contentContainer.querySelector(`[data-file-name="${file.path}"]`);
            if (element) {
                this.activeFileObserver.observe(element);
            }
        });
    }

    private removeFileFromDOM(filePath: string) {
        const element = this.contentContainer.querySelector(`[data-file-name="${filePath}"]`);
        if (element) {
            this.activeFileObserver.unobserve(element);
            element.remove();
        }
    }

    private removeFilesFromDOM(files: TFile[]) {
        files.forEach(file => {
            const element = this.contentContainer.querySelector(`[data-file-name="${file.path}"]`);
            if (element) {
                this.activeFileObserver.unobserve(element);
                element.remove();
            }
        });
    }

    private createScrollElements(container: HTMLElement) {
        this.topIndicator = container.createDiv({
            cls: "scroll-indicator top-indicator",
            text: "⇈",
            attr: { style: "display: none;" }
        });
        this.topSentinel = container.createDiv({
            cls: "scroll-sentinel top-sentinel",
            attr: { style: "height: 1px; width: 100%; opacity: 0;" }
        });
        this.contentContainer = container.createDiv("file-content-container");
        this.bottomSentinel = container.createDiv({
            cls: "scroll-sentinel bottom-sentinel",
            attr: { style: "height: 1px; width: 100%; opacity: 0;" }
        });
        this.bottomIndicator = container.createDiv({
            cls: "scroll-indicator bottom-indicator",
            text: "⇊",
            attr: { style: "display: none;" }
        });
        setTimeout(() => {
            this.setupIntersectionObserver();
            this.setupActiveFileObserver();
            if (this.intersectionObserver && this.bottomSentinel) {
                this.intersectionObserver.observe(this.bottomSentinel);
                this.bottomIndicator.style.display = "block";
            }
        }, 150);
    }

    private updateScrollElements() {
        if (!this.intersectionObserver) this.setupIntersectionObserver();
        this.intersectionObserver.disconnect();

        if (this.currentIndex > 0) {
            this.intersectionObserver.observe(this.topSentinel);
            this.topIndicator.style.display = "block";
        } else {
            this.topIndicator.style.display = "none";
        }

        const totalAccessible = this.currentIndex + this.loadedFiles.length;
        const hasMoreFiles = totalAccessible < this.allFiles.length;

        if (hasMoreFiles) {
            this.intersectionObserver.observe(this.bottomSentinel);
            this.bottomIndicator.style.display = "block";
        } else {
            this.bottomIndicator.style.display = "none";
        }
    }
}
