import { ItemView, WorkspaceLeaf, TFile, TFolder, MarkdownRenderer, Notice, MarkdownView, WorkspaceTabs, WorkspaceSplit } from 'obsidian';
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
    private topIndicator: HTMLElement;
    private bottomIndicator: HTMLElement;
    private intersectionObserver: IntersectionObserver;
    private contentContainer: HTMLElement;
    private activeFileObserver: IntersectionObserver;
    private lastHighlighted: HTMLElement | null = null;

    private activeEditor: {
        file: TFile,
        container: HTMLElement,
        leaf: WorkspaceLeaf,
        markdownView: MarkdownView,
        cleanupFunctions: (() => void)[]
    } | null = null;
    private clickOutsideHandler: ((event: MouseEvent | KeyboardEvent) => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: EnhancedContinuousModePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.setupIntersectionObserver();
        this.setupActiveFileObserver();
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

        this.addAction('document', 'Export as single document', () => this.exportToSingleFile());
        this.createScrollElements(container);

        if (!this.currentFolder) {
            this.showFolderSelector(container);
        }
    }

    async onClose() {
        await this.cleanupResources();
    }

    private setupIntersectionObserver() {
        const options = { root: this.containerEl.children[1], rootMargin: '200px', threshold: 0 };
        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                if (entry.target === this.topSentinel) this.loadPreviousFilesDebounced();
                else if (entry.target === this.bottomSentinel) this.loadNextFilesDebounced();
            });
        }, options);
    }

    private setupActiveFileObserver() {
        const options = { root: this.containerEl.querySelector('.enhanced-continuous-container'), rootMargin: '-50% 0px -50% 0px', threshold: 0 };
        this.activeFileObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) this.highlightFileInExplorer(entry.target as HTMLElement);
            });
        }, options);
    }

    private highlightFileInExplorer(fileContainer: HTMLElement) {
        const filePath = fileContainer.dataset.fileName;
        if (!filePath) return;
        if (this.lastHighlighted) this.lastHighlighted.removeClass('is-active-in-continuous-view');

        const fileExplorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')?.[0];
        if (fileExplorerLeaf) {
            const explorerEl = fileExplorerLeaf.view.containerEl;
            const newHighlightEl = explorerEl.querySelector(`.nav-file-title[data-path="${filePath}"]`) as HTMLElement;
            if (newHighlightEl) {
                newHighlightEl.addClass('is-active-in-continuous-view');
                this.lastHighlighted = newHighlightEl;
            }
        }
    }

    private getSortedFilesInFolder(folder: TFolder): TFile[] {
        const markdownFiles = this.app.vault.getMarkdownFiles().filter(file => file.parent && file.parent.path === folder.path);
        const fileExplorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')?.[0];
        if (!fileExplorerLeaf) return markdownFiles.sort((a, b) => a.name.localeCompare(b.name));

        const explorerEl = fileExplorerLeaf.view.containerEl;
        const folderTitleEl = explorerEl.querySelector(`.nav-folder-title[data-path="${folder.path}"]`);
        const folderChildrenEl = folderTitleEl?.nextElementSibling;
        if (!folderChildrenEl || !folderChildrenEl.hasClass('nav-folder-children')) return markdownFiles.sort((a, b) => a.name.localeCompare(b.name));

        const fileNodes = folderChildrenEl.querySelectorAll('.nav-file-title');
        if (fileNodes.length === 0) return markdownFiles.sort((a, b) => a.name.localeCompare(b.name));

        const sortedPaths = Array.from(fileNodes).map(node => (node as HTMLElement).dataset.path).filter((path): path is string => !!path);
        const fileMap = new Map(markdownFiles.map(f => [f.path, f]));
        const sortedFiles = sortedPaths.map(path => fileMap.get(path)).filter((file): file is TFile => !!file);
        const sortedFilePaths = new Set(sortedFiles.map(f => f.path));
        const unsortedFiles = markdownFiles.filter(f => !sortedFilePaths.has(f.path));

        return [...sortedFiles, ...unsortedFiles.sort((a, b) => a.name.localeCompare(b.name))];
    }

    public async loadFolder(folder: TFolder) {
        await this.cleanupResources();
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.createScrollElements(container);

        this.currentFolder = folder;
        this.updateDisplayText();

        this.allFiles = this.getSortedFilesInFolder(folder);
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
        this.updateScrollElements();
    }

    private async loadNextFiles() {
        if (this.currentIndex + this.loadedFiles.length >= this.allFiles.length) return;
        const spaceLeft = this.plugin.settings.maxFileCount - this.loadedFiles.length;
        if (spaceLeft <= 0) {
            const unloadCount = Math.min(this.plugin.settings.loadUnloadCount, this.loadedFiles.length);
            this.removeFilesFromDOM(this.loadedFiles.splice(0, unloadCount));
            this.currentIndex += unloadCount;
        }
        const loadCount = this.plugin.settings.loadUnloadCount;
        const nextFileIndex = this.currentIndex + this.loadedFiles.length;
        const newFiles = this.allFiles.slice(nextFileIndex, nextFileIndex + loadCount);
        if (newFiles.length > 0) {
            this.loadedFiles.push(...newFiles);
            await this.appendFilesToDOM(newFiles);
        }
        this.updateScrollElements();
    }

    private async loadPreviousFiles() {
        if (this.currentIndex === 0) return;
        const spaceLeft = this.plugin.settings.maxFileCount - this.loadedFiles.length;
        if (spaceLeft <= 0) {
            const unloadCount = Math.min(this.plugin.settings.loadUnloadCount, this.loadedFiles.length);
            this.removeFilesFromDOM(this.loadedFiles.splice(this.loadedFiles.length - unloadCount, unloadCount));
        }
        const loadCount = this.plugin.settings.loadUnloadCount;
        const newIndex = Math.max(0, this.currentIndex - loadCount);
        const newFiles = this.allFiles.slice(newIndex, this.currentIndex);
        if (newFiles.length > 0) {
            this.loadedFiles.unshift(...newFiles);
            this.currentIndex = newIndex;
            await this.prependFilesToDOM(newFiles);
        }
        this.updateScrollElements();
    }

    private async renderFiles() {
        this.contentContainer.empty();
        for (const file of this.loadedFiles) await this.appendFileToDOM(file, this.contentContainer);
    }

    private async renderFileContent(file: TFile, contentDiv: HTMLElement) {
        contentDiv.empty();
        const fileContent = await this.app.vault.cachedRead(file);
        await MarkdownRenderer.render(this.app, fileContent, contentDiv, file.path, this);
    }

    private async createFileElement(file: TFile): Promise<HTMLElement> {
        const fileContainer = createDiv('file-container');
        fileContainer.dataset.fileName = file.path;

        const headerEl = fileContainer.createDiv('file-header').createEl('h2', {
            text: file.basename,
            cls: 'file-title'
        });
        headerEl.style.cursor = 'pointer';
        headerEl.addEventListener('click', () =>
            this.app.workspace.getLeaf('tab').openFile(file)
        );

        const contentEl = fileContainer.createDiv('file-content');
        contentEl.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.switchToEditorView(file, fileContainer);
        });

        await this.renderFileContent(file, contentEl);
        this.activeFileObserver.observe(fileContainer);

        return fileContainer;
    }

    async switchToEditorView(file: TFile, container: HTMLElement) {
        if (this.activeEditor) {
            await this.cleanupActiveEditor();
        }

        const contentDiv = container.querySelector('.file-content') as HTMLElement;
        if (!contentDiv) return;

        contentDiv.empty();
        const editorContainer = contentDiv.createDiv('inline-editor-container');

        // Create a new leaf in the same split as our view
        const leaf = this.app.workspace.createLeafInParent(this.leaf.parent, -1);
        leaf.setPinned(true);

        await leaf.openFile(file);

        // This is the crucial part: hide the leaf's tab/UI elements
        const leafParent = (leaf.view.containerEl.parentElement as HTMLElement);
        if (leafParent) {
            leafParent.style.display = 'none';
        }

        const markdownView = leaf.view as MarkdownView;
        if (markdownView && markdownView.editor) {
            // Append the entire view container, not just the editor
            editorContainer.appendChild(leaf.view.containerEl);

            const cleanupFunctions: (() => void)[] = [];
            const focusinHandler = () => {
                this.app.workspace.setActiveLeaf(leaf, { focus: true });
            };
            editorContainer.addEventListener("focusin", focusinHandler);
            cleanupFunctions.push(() => editorContainer.removeEventListener("focusin", focusinHandler));

            this.activeEditor = {
                file: file,
                container: container,
                leaf: leaf,
                markdownView: markdownView,
                cleanupFunctions: cleanupFunctions
            };

            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            this.setupClickOutsideHandler(container);
        } else {
            leaf.detach();
        }
    }

    async cleanupActiveEditor() {
        if (!this.activeEditor) return;

        const { file, container, leaf, markdownView, cleanupFunctions } = this.activeEditor;

        // First, perform cleanup that doesn't involve the DOM
        cleanupFunctions.forEach(fn => fn());

        if (markdownView && markdownView.editor) {
            await (markdownView as any).save();
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Crucially, detach the leaf BEFORE clearing the parent DOM element.
        // This lets Obsidian handle the leaf's removal properly.
        if (leaf) {
            leaf.setPinned(false);
            leaf.detach();
        }

        // Now that the leaf is gone, we can safely re-render our view
        const contentDiv = container.querySelector('.file-content') as HTMLElement;
        if (contentDiv) {
            contentDiv.empty();
            try {
                const updatedContent = await this.app.vault.cachedRead(file);
                await MarkdownRenderer.render(this.app, updatedContent, contentDiv, file.path, this);
            } catch (error) {
                console.error('Error refreshing content:', error);
                await this.renderFileContent(file, contentDiv);
            }
        }

        this.activeEditor = null;

        if (this.clickOutsideHandler) {
            document.removeEventListener('click', this.clickOutsideHandler, true);
            document.removeEventListener('keydown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
    }

    setupClickOutsideHandler(container: HTMLElement) {
        this.clickOutsideHandler = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof MouseEvent) {
                const target = event.target as HTMLElement;
                if (target.closest('.modal') ||
                    target.closest('.suggestion-container') ||
                    target.closest('.tooltip') ||
                    target.closest('.popover')) {
                    return;
                }

                if (!container.contains(target)) {
                    this.cleanupActiveEditor();
                }
            } else if (event instanceof KeyboardEvent) {
                if (event.key === 'Escape') {
                    this.cleanupActiveEditor();
                }
            }
        };

        setTimeout(() => {
            document.addEventListener('click', this.clickOutsideHandler!, true);
            document.addEventListener('keydown', this.clickOutsideHandler!);
        }, 100);
    }

    private async appendFileToDOM(file: TFile, container: HTMLElement) {
        container.appendChild(await this.createFileElement(file));
    }

    private async appendFilesToDOM(files: TFile[]) {
        for (const file of files) {
            await this.appendFileToDOM(file, this.contentContainer);
        }
    }

    private async prependFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        for (const file of files.reverse()) fragment.prepend(await this.createFileElement(file));
        this.contentContainer.prepend(fragment);
    }

    private removeFileFromDOM(filePath: string) {
        const element = this.contentContainer.querySelector(`[data-file-name="${filePath}"]`);
        if (element) {
            this.activeFileObserver.unobserve(element);
            element.remove();
        }
    }

    private removeFilesFromDOM(files: TFile[]) {
        files.forEach(file => this.removeFileFromDOM(file.path));
    }

    private createScrollElements(container: HTMLElement) {
        this.topIndicator = container.createDiv({ cls: 'scroll-indicator top-indicator', text: '⇑' });
        this.topSentinel = container.createDiv('scroll-sentinel top-sentinel');
        this.contentContainer = container.createDiv('file-content-container');
        this.bottomSentinel = container.createDiv('scroll-sentinel bottom-sentinel');
        this.bottomIndicator = container.createDiv({ cls: 'scroll-indicator bottom-indicator', text: '⇓' });
    }

    private updateScrollElements() {
        this.intersectionObserver.disconnect();
        if (this.currentIndex > 0) this.intersectionObserver.observe(this.topSentinel);
        if (this.currentIndex + this.loadedFiles.length < this.allFiles.length) this.intersectionObserver.observe(this.bottomSentinel);
        this.topIndicator.style.display = this.currentIndex > 0 ? 'block' : 'none';
        this.bottomIndicator.style.display = this.currentIndex + this.loadedFiles.length < this.allFiles.length ? 'block' : 'none';
    }

    private showFolderSelector(container: HTMLElement) {
        const selectorContainer = container.createDiv('folder-selector-container');
        selectorContainer.createEl('h3', { text: 'Select a folder to scroll through' });
        const button = selectorContainer.createEl('button', { text: 'Choose Folder', cls: 'mod-cta' });
        button.onclick = () => new FolderSuggestionModal(this.app, (folder: TFolder) => this.plugin.activateView(folder)).open();
    }

    private showEmptyFolderMessage() {
        this.contentContainer.empty();
        this.contentContainer.createEl('p', {text: "This folder contains no markdown files."});
    }

    private async cleanupResources() {
        await this.cleanupActiveEditor();
        if (this.intersectionObserver) this.intersectionObserver.disconnect();
        if (this.activeFileObserver) this.activeFileObserver.disconnect();
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('is-active-in-continuous-view');
            this.lastHighlighted = null;
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
        if (this.getDisplayText() !== newDisplayText) (this.leaf as any).rebuildView();
    }

    private async exportToSingleFile() {
        if (!this.currentFolder || this.allFiles.length === 0) {
            new Notice('No folder or files to export.');
            return;
        }
        let combinedContent = `# Combined notes from ${this.currentFolder.name}\n\n`;
        for (const file of this.allFiles) {
            const content = await this.app.vault.read(file);
            combinedContent += `\n\n---\n\n## ${file.basename}\n\n${content}`;
        }
        const newFileName = `Combined - ${this.currentFolder.name}.md`;
        let newFilePath = this.currentFolder.isRoot() ? newFileName : `${this.currentFolder.path}/${newFileName}`;
        try {
            if (this.app.vault.getAbstractFileByPath(newFilePath)) {
                new Notice(`File "${newFileName}" already exists. Please rename or remove it first.`);
                return;
            }
            const createdFile = await this.app.vault.create(newFilePath, combinedContent);
            new Notice(`Successfully exported to "${createdFile.path}".`);
            this.app.workspace.getLeaf('tab').openFile(createdFile);
        } catch (error) {
            console.error("Error exporting to single file:", error);
            new Notice('Failed to export file.');
        }
    }
}