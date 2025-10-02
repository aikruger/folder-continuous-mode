import { ItemView, WorkspaceLeaf, TFile, TFolder, MarkdownRenderer, Notice, MarkdownView } from 'obsidian';
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
    private focusLockActive: boolean = false;
    private currentEditingElement: HTMLElement | null = null;

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

        const contentEl = fileContainer.createDiv('file-content');

        if (this.plugin.settings.clickBehavior !== 'disabled') {
            headerEl.style.cursor = 'pointer';
            headerEl.addEventListener('click', (event) => {
                this.handleTitleClick(file, event);
            });
        }

        if (this.plugin.settings.clickBehavior === 'normal') {
            contentEl.addEventListener('click', () => {
                this.app.workspace.getLeaf('window').openFile(file);
            });
        } else if (this.plugin.settings.clickBehavior === 'preserve-focus') {
            contentEl.addEventListener('click', (event) => {
                this.handleContentClick(file, fileContainer, event);
            });
        }

        if (this.plugin.settings.doubleClickToEdit) {
            contentEl.addEventListener('dblclick', async (event) => {
                if ((event.target as HTMLElement).closest('a, button, input, textarea, [contenteditable]')) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();

                const editor = this.createInPlaceEditor(fileContainer, file);
                const content = await this.app.vault.read(file);
                editor.value = content;
                this.enterEditMode(editor, fileContainer);
                this.setupExitHandlers(editor, fileContainer, file);
            });
        }

        await this.renderFileContent(file, contentEl);
        this.activeFileObserver.observe(fileContainer);

        return fileContainer;
    }

    private handleTitleClick(file: TFile, event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf) {
            this.app.workspace.getLeaf('tab').openFile(file);
            return;
        }

        const view = activeLeaf.view;
        if (this.plugin.settings.preserveEditorFocus && view instanceof MarkdownView) {
            const state = view.getState() as { mode: string };
            const isEditing = state.mode?.includes('source');

            if (isEditing && view.editor && document.activeElement) {
                const currentFocusElement = document.activeElement;
                const currentSelection = view.editor.getCursor();
                this.openFilePreservingFocus(file, 'tab', currentFocusElement, currentSelection);
            } else {
                this.app.workspace.getLeaf('tab').openFile(file);
            }
        } else {
            this.app.workspace.getLeaf('tab').openFile(file);
        }
    }

    private createInPlaceEditor(fileContainer: HTMLElement, file: TFile): HTMLTextAreaElement {
        const contentDiv = fileContainer.querySelector('.file-content') as HTMLElement;
        contentDiv.empty();

        const editorContainer = contentDiv.createDiv('inline-editor-container');
        const textarea = editorContainer.createEl('textarea', {
            cls: 'inline-editor-textarea'
        });

        // CRITICAL: Implement focus lock immediately
        this.implementFocusLock(textarea, fileContainer);

        return textarea;
    }

    private handleContentClick(file: TFile, fileContainer: HTMLElement, event: MouseEvent) {
        if ((event.target as HTMLElement).closest('a, button, input, textarea, [contenteditable]')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        this.highlightFileTemporarily(fileContainer);

        if (this.plugin.settings.showFilePreviewTooltips) {
            this.showFilePreview(file, event.clientX, event.clientY);
        }
    }

    private implementFocusLock(textarea: HTMLTextAreaElement, container: HTMLElement) {
        this.focusLockActive = true;
        this.currentEditingElement = textarea;

        // Force and maintain focus
        textarea.focus();

        // Prevent focus loss through aggressive re-focusing
        const maintainFocus = () => {
            if (this.focusLockActive && document.activeElement !== textarea) {
                textarea.focus();
            }
        };

        // Multiple focus maintenance strategies
        const focusInterval = setInterval(maintainFocus, 100);

        // Store cleanup function
        (textarea as any)._focusCleanup = () => {
            clearInterval(focusInterval);
            this.focusLockActive = false;
            this.currentEditingElement = null;
        };
    }

    private setupEventBlocking(textarea: HTMLTextAreaElement, container: HTMLElement) {
        // Block all focus-stealing events during editing
        const preventFocusLoss = (event: Event) => {
            if (this.focusLockActive && event.target !== textarea) {
                event.preventDefault();
                event.stopImmediatePropagation();
                textarea.focus();
            }
        };

        // Capture events at document level
        const eventTypes = ['mousedown', 'mouseup', 'click', 'focus', 'blur', 'keydown'];

        eventTypes.forEach(eventType => {
            document.addEventListener(eventType, preventFocusLoss, true);
        });

        // Store cleanup
        (textarea as any)._eventCleanup = () => {
            eventTypes.forEach(eventType => {
                document.removeEventListener(eventType, preventFocusLoss, true);
            });
        };
    }

    private overrideObsidianFocus(textarea: HTMLTextAreaElement) {
        // Override setActiveLeaf temporarily
        const originalSetActiveLeaf = this.app.workspace.setActiveLeaf.bind(this.app.workspace);

        this.app.workspace.setActiveLeaf = (leaf: WorkspaceLeaf, pushHistoryOrParams?: boolean | { focus?: boolean }, focus?: boolean): void => {
            // Block setActiveLeaf calls during editing
            if (this.focusLockActive) {
                textarea.focus();
                return;
            }

            // Handle the two overloads of setActiveLeaf
            if (typeof pushHistoryOrParams === 'boolean') {
                (originalSetActiveLeaf as any)(leaf, pushHistoryOrParams, focus);
            } else {
                (originalSetActiveLeaf as any)(leaf, pushHistoryOrParams);
            }
        };

        // Store cleanup
        (textarea as any)._obsidianCleanup = () => {
            this.app.workspace.setActiveLeaf = originalSetActiveLeaf;
        };
    }

    private enterEditMode(textarea: HTMLTextAreaElement, container: HTMLElement) {
        // Mark container as actively editing
        this.containerEl.addClass('editing-active');

        // Create focus lock overlay
        const overlay = document.createElement('div');
        overlay.className = 'focus-lock-overlay';
        document.body.appendChild(overlay);

        // Redirect overlay clicks to textarea
        overlay.addEventListener('click', () => {
            textarea.focus();
        });

        // Implement all focus management strategies
        this.implementFocusLock(textarea, container);
        this.setupEventBlocking(textarea, container);
        this.overrideObsidianFocus(textarea);

        // Store overlay for cleanup
        (textarea as any)._overlay = overlay;
    }

    private exitEditMode(textarea: HTMLTextAreaElement, container: HTMLElement) {
        // Clean up all focus management
        if ((textarea as any)._focusCleanup) {
            (textarea as any)._focusCleanup();
        }
        if ((textarea as any)._eventCleanup) {
            (textarea as any)._eventCleanup();
        }
        if ((textarea as any)._obsidianCleanup) {
            (textarea as any)._obsidianCleanup();
        }

        // Remove overlay
        const overlay = (textarea as any)._overlay;
        if (overlay) {
            overlay.remove();
        }

        // Remove editing class
        this.containerEl.removeClass('editing-active');

        // Reset state
        this.focusLockActive = false;
        this.currentEditingElement = null;
    }

    private setupExitHandlers(textarea: HTMLTextAreaElement, container: HTMLElement, file: TFile) {
        let isExiting = false;

        const handleExit = async () => {
            if (isExiting) return;
            isExiting = true;

            try {
                // Save the content
                const content = textarea.value;
                await this.app.vault.modify(file, content);

                // Exit edit mode FIRST
                this.exitEditMode(textarea, container);

                // Then re-render
                const contentDiv = container.querySelector('.file-content') as HTMLElement;
                await this.renderFileContent(file, contentDiv);

            } catch (error) {
                console.error('Error saving file:', error);
                new Notice('Failed to save file');
            }
        };

        // Exit on Escape
        textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                handleExit();
            }
        });

        // Exit on Ctrl+Enter (save shortcut)
        textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                handleExit();
            }
        });

        // Enhanced blur detection - but with delay to prevent accidental exits
        let blurTimeout: NodeJS.Timeout;
        textarea.addEventListener('blur', () => {
            blurTimeout = setTimeout(() => {
                if (!this.focusLockActive) return; // Already exited
                handleExit();
            }, 200); // 200ms delay
        });

        textarea.addEventListener('focus', () => {
            clearTimeout(blurTimeout);
        });
    }

    private async openFilePreservingFocus(file: TFile, leafType: 'tab' | 'window', preserveFocusElement?: Element | null, preserveCursorPosition?: any) {
        try {
            const newLeaf = this.app.workspace.getLeaf(leafType);
            await newLeaf.openFile(file, { active: false });

            if (preserveFocusElement && (preserveFocusElement as HTMLElement).isConnected) {
                (preserveFocusElement as HTMLElement).focus();

                if (preserveCursorPosition) {
                    setTimeout(() => {
                        const activeLeaf = this.app.workspace.activeLeaf;
                        if (activeLeaf?.view instanceof MarkdownView && activeLeaf.view.editor) {
                            activeLeaf.view.editor.setCursor(preserveCursorPosition);
                        }
                    }, 10);
                }
            }
        } catch (error) {
            console.error('Error opening file while preserving focus:', error);
            this.app.workspace.getLeaf(leafType).openFile(file);
        }
    }

    private highlightFileTemporarily(fileContainer: HTMLElement) {
        fileContainer.addClass('temporary-highlight');
        setTimeout(() => {
            fileContainer.removeClass('temporary-highlight');
        }, 1000);
    }

    private showFilePreview(file: TFile, x: number, y: number) {
        const tooltip = document.body.createDiv('file-preview-tooltip');
        tooltip.textContent = `Click title to open "${file.basename}" in new tab`;
        tooltip.style.position = 'fixed';
        tooltip.style.left = `${x + 10}px`;
        tooltip.style.top = `${y - 30}px`;
        tooltip.style.zIndex = '1000';

        setTimeout(() => {
            tooltip.remove();
        }, 2000);
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