import { ItemView, WorkspaceLeaf, TFile, TFolder, MarkdownRenderer } from 'obsidian';
import EnhancedContinuousModePlugin from './main';
import { FolderSuggestionModal } from './folderModal';

export const ENHANCED_CONTINUOUS_VIEW_TYPE = 'enhanced-continuous-view';

export class EnhancedContinuousView extends ItemView {
    private plugin: EnhancedContinuousModePlugin;
    private currentFolder: TFolder | null = null;
    private allFiles: TFile[] = [];
    private loadedFiles: TFile[] = [];
    private currentIndex = 0;

    private topSentinel: HTMLElement;
    private bottomSentinel: HTMLElement;
    private intersectionObserver: IntersectionObserver;
    private contentContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: EnhancedContinuousModePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.setupIntersectionObserver();
    }

    getViewType(): string {
        return ENHANCED_CONTINUOUS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.currentFolder ? `Continuous: ${this.currentFolder.name}` : 'Enhanced Continuous View';
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('enhanced-continuous-container');

        this.createSentinels(container);

        if (!this.currentFolder) {
            this.showFolderSelector(container);
        }
    }

    async onClose() {
        this.cleanupResources();
    }

    private setupIntersectionObserver() {
        const options = {
            root: this.containerEl.children[1],
            rootMargin: '200px',
            threshold: 0
        };

        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    if (entry.target === this.topSentinel) {
                        this.loadPreviousFilesDebounced();
                    } else if (entry.target === this.bottomSentinel) {
                        this.loadNextFilesDebounced();
                    }
                }
            });
        }, options);
    }

    public async loadFolder(folder: TFolder) {
        this.cleanupResources(); // Clean up previous state
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.createSentinels(container);

        this.currentFolder = folder;
        this.updateDisplayText();

        this.allFiles = this.app.vault.getMarkdownFiles()
            .filter(file => file.parent && file.parent.path === folder.path)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (this.allFiles.length === 0) {
            this.showEmptyFolderMessage();
            return;
        }

        await this.loadInitialFiles();
    }

    private async loadInitialFiles() {
        const initialCount = Math.min(this.plugin.settings.initialFileCount, this.allFiles.length);
        this.currentIndex = 0;
        this.loadedFiles = this.allFiles.slice(0, initialCount);

        await this.renderFiles();
        this.updateSentinels();
    }

    private async loadNextFiles() {
        if (this.currentIndex + this.loadedFiles.length >= this.allFiles.length) {
            return;
        }

        const spaceLeft = this.plugin.settings.maxFileCount - this.loadedFiles.length;
        if(spaceLeft <= 0) { // Unload some files to make space
            const unloadCount = Math.min(this.plugin.settings.loadUnloadCount, this.loadedFiles.length);
            const removedFiles = this.loadedFiles.splice(0, unloadCount);
            this.removeFilesFromDOM(removedFiles);
            this.currentIndex += unloadCount;
        }

        const loadCount = this.plugin.settings.loadUnloadCount;
        const nextFileIndex = this.currentIndex + this.loadedFiles.length;
        const newFiles = this.allFiles.slice(nextFileIndex, nextFileIndex + loadCount);

        if(newFiles.length > 0) {
            this.loadedFiles.push(...newFiles);
            await this.appendFilesToDOM(newFiles);
        }

        this.updateSentinels();
    }

    private async loadPreviousFiles() {
        if (this.currentIndex === 0) {
            return;
        }

        const spaceLeft = this.plugin.settings.maxFileCount - this.loadedFiles.length;
        if(spaceLeft <= 0) { // Unload some files to make space
            const unloadCount = Math.min(this.plugin.settings.loadUnloadCount, this.loadedFiles.length);
            const removedFiles = this.loadedFiles.splice(this.loadedFiles.length - unloadCount, unloadCount);
            this.removeFilesFromDOM(removedFiles);
        }

        const loadCount = this.plugin.settings.loadUnloadCount;
        const newIndex = Math.max(0, this.currentIndex - loadCount);
        const newFiles = this.allFiles.slice(newIndex, this.currentIndex);

        if(newFiles.length > 0) {
            this.loadedFiles.unshift(...newFiles);
            this.currentIndex = newIndex;
            await this.prependFilesToDOM(newFiles);
        }

        this.updateSentinels();
    }

    private async renderFiles() {
        this.contentContainer.empty();
        for (const file of this.loadedFiles) {
            await this.appendFileToDOM(file, this.contentContainer);
        }
    }

    private async createFileElement(file: TFile): Promise<HTMLElement> {
        const fileContainer = createDiv('file-container');
        fileContainer.dataset.fileName = file.path;

        const header = fileContainer.createDiv('file-header');
        header.createEl('h2', { text: file.basename, cls: 'file-title' });

        const contentDiv = fileContainer.createDiv('file-content');
        const fileContent = await this.app.vault.cachedRead(file);

        await MarkdownRenderer.render(this.app, fileContent, contentDiv, file.path, this);

        return fileContainer;
    }

    private async appendFileToDOM(file: TFile, container: HTMLElement) {
        const fileEl = await this.createFileElement(file);
        container.appendChild(fileEl);
    }

    private async appendFilesToDOM(files: TFile[]) {
        for (const file of files) {
            await this.appendFileToDOM(file, this.contentContainer);
        }
    }

    private async prependFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        for (const file of files.reverse()) { // Prepend needs reversed order
            const fileEl = await this.createFileElement(file);
            fragment.prepend(fileEl);
        }
        this.contentContainer.prepend(fragment);
    }

    private removeFilesFromDOM(files: TFile[]) {
        files.forEach(file => {
            const element = this.contentContainer.querySelector(`[data-file-name="${file.path}"]`);
            if (element) {
                element.remove();
            }
        });
    }

    private createSentinels(container: HTMLElement) {
        this.topSentinel = container.createDiv('scroll-sentinel top-sentinel');
        this.contentContainer = container.createDiv('file-content-container');
        this.bottomSentinel = container.createDiv('scroll-sentinel bottom-sentinel');
    }

    private updateSentinels() {
        this.intersectionObserver.disconnect();

        if (this.currentIndex > 0) {
            this.intersectionObserver.observe(this.topSentinel);
        }
        if (this.currentIndex + this.loadedFiles.length < this.allFiles.length) {
            this.intersectionObserver.observe(this.bottomSentinel);
        }
    }

    private showFolderSelector(container: HTMLElement) {
        const selectorContainer = container.createDiv('folder-selector-container');
        selectorContainer.createEl('h3', { text: 'Select a folder to scroll through' });
        const button = selectorContainer.createEl('button', { text: 'Choose Folder', cls: 'mod-cta' });
        button.onclick = () => {
            new FolderSuggestionModal(this.app, (folder: TFolder) => {
                this.plugin.activateView(folder);
            }).open();
        };
    }

    private showEmptyFolderMessage() {
        this.contentContainer.empty();
        this.contentContainer.createEl('p', {text: "This folder contains no markdown files."});
    }

    private cleanupResources() {
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
        }
        this.loadedFiles = [];
        this.allFiles = [];
        this.currentFolder = null;
        this.currentIndex = 0;
        if(this.contentContainer) this.contentContainer.empty();
    }

    private debounce(func: Function, wait: number) {
        let timeout: NodeJS.Timeout;
        return (...args: any[]) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    private loadNextFilesDebounced = this.debounce(this.loadNextFiles.bind(this), 200);
    private loadPreviousFilesDebounced = this.debounce(this.loadPreviousFiles.bind(this), 200);

    private updateDisplayText() {
        const newDisplayText = this.currentFolder ? `Continuous: ${this.currentFolder.name}` : 'Enhanced Continuous View';
        if (this.getDisplayText() !== newDisplayText) {
            // This is a bit of a hack to force the display text to update.
            // There isn't a public API for this.
            (this.leaf as any).rebuildView();
        }
    }
}