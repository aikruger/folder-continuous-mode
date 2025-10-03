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

    // Properties for focus management
    private focusLockActive: boolean = false;
    private currentEditingElement: HTMLTextAreaElement | null = null;
    private originalSetActiveLeaf: ((leaf: WorkspaceLeaf, params?: { focus?: boolean; }) => void) |
                                  ((leaf: WorkspaceLeaf, pushHistory: boolean, focus: boolean) => void) | null = null;


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
        } else if (this.plugin.settings.clickBehavior === 'in-place-edit') {
            contentEl.addEventListener('dblclick', async (event) => {
                if ((event.target as HTMLElement).closest('a, button, input, textarea, [contenteditable]')) {
                    return;
                }
                // Prevent selecting text on double-click
                if (window.getSelection()) {
                    window.getSelection()?.removeAllRanges();
                }
                const content = await this.app.vault.cachedRead(file);
                this.enterEditMode(contentEl, file, content);
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

    // In-place editing methods
    private enterEditMode(container: HTMLElement, file: TFile, content: string) {
        if (this.focusLockActive) return;

        this.containerEl.addClass('editing-active');

        const editorContainer = createDiv('inline-editor-container');
        const textarea = createEl('textarea', { cls: 'inline-editor-textarea' });
        textarea.value = content;

        const saveAndExit = async () => {
            const newContent = textarea.value;
            await this.app.vault.modify(file, newContent);
            this.exitEditMode(container, file, newContent);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.exitEditMode(container, file, content); // Exit without saving on Escape
            } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                saveAndExit();
                new Notice(`${file.basename} saved!`);
            }
        };
        textarea.addEventListener('keydown', handleKeyDown);

        editorContainer.appendChild(textarea);
        container.empty();
        container.appendChild(editorContainer);

        // Create more aggressive overlay
        const overlay = document.createElement('div');
        overlay.className = 'focus-lock-overlay';
        overlay.style.zIndex = '999999'; // Higher z-index
        document.body.appendChild(overlay);

        const redirectToTextarea = (event: MouseEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            textarea.focus();
            if (textarea.value.length > 0) {
                const cursorPos = Math.min(textarea.selectionStart, textarea.value.length);
                textarea.setSelectionRange(cursorPos, cursorPos);
            }
        };

        overlay.addEventListener('mousedown', redirectToTextarea, true);
        overlay.addEventListener('click', redirectToTextarea, true);
        overlay.addEventListener('mouseup', redirectToTextarea, true);

        // Implement all focus strategies
        this.implementFocusLock(textarea, container);
        this.setupEventBlocking(textarea, container);
        this.overrideObsidianFocus(textarea);

        // Store cleanup functions
        (textarea as any)._overlay = overlay;

        const keydownCleanup = () => textarea.removeEventListener('keydown', handleKeyDown);
        const overlayCleanup = () => {
            overlay.removeEventListener('mousedown', redirectToTextarea, true);
            overlay.removeEventListener('click', redirectToTextarea, true);
            overlay.removeEventListener('mouseup', redirectToTextarea, true);
        };

        const existingEventCleanup = (textarea as any)._eventCleanup || (() => {});
        (textarea as any)._eventCleanup = () => {
            existingEventCleanup();
            keydownCleanup();
            overlayCleanup();
        };
    }

    private exitEditMode(container: HTMLElement, file: TFile, newContent: string) {
        if (!this.focusLockActive) return;

        if (this.currentEditingElement && (this.currentEditingElement as any)._focusCleanup) {
            (this.currentEditingElement as any)._focusCleanup();
        }
        if (this.currentEditingElement && (this.currentEditingElement as any)._eventCleanup) {
            (this.currentEditingElement as any)._eventCleanup();
        }
        if (this.currentEditingElement && (this.currentEditingElement as any)._overlay) {
            (this.currentEditingElement as any)._overlay.remove();
        }

        if (this.originalSetActiveLeaf) {
            this.app.workspace.setActiveLeaf = this.originalSetActiveLeaf as any;
            this.originalSetActiveLeaf = null;
        }

        this.focusLockActive = false;
        this.currentEditingElement = null;

        this.renderFileContent(file, container);
        this.containerEl.removeClass('editing-active');
    }

    implementFocusLock(textarea: HTMLTextAreaElement, container: HTMLElement) {
        this.focusLockActive = true;
        this.currentEditingElement = textarea;

        const focusWithSelection = () => {
            if (!this.focusLockActive) return;
            const selection = { start: textarea.selectionStart, end: textarea.selectionEnd };
            textarea.focus();
            setTimeout(() => {
                if (textarea === document.activeElement) {
                    textarea.setSelectionRange(selection.start, selection.end);
                }
            }, 0);
        };

        focusWithSelection();

        const focusInterval = setInterval(() => {
            if (!this.focusLockActive) {
                clearInterval(focusInterval);
                return;
            }
            if (document.activeElement !== textarea) {
                focusWithSelection();
            }
        }, 50);

        const preventAllMouseEvents = (event: MouseEvent) => {
            if (!this.focusLockActive) return;
            if (event.target !== textarea && !textarea.contains(event.target as Node)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                focusWithSelection();
            }
        };

        document.addEventListener('mousedown', preventAllMouseEvents, true);
        document.addEventListener('mouseup', preventAllMouseEvents, true);
        document.addEventListener('click', preventAllMouseEvents, true);

        (textarea as any)._focusCleanup = () => {
            clearInterval(focusInterval);
            document.removeEventListener('mousedown', preventAllMouseEvents, true);
            document.removeEventListener('mouseup', preventAllMouseEvents, true);
            document.removeEventListener('click', preventAllMouseEvents, true);
            this.focusLockActive = false;
            this.currentEditingElement = null;
        };

        this.emergencyFocusRecovery(textarea);
    }

    setupEventBlocking(textarea: HTMLTextAreaElement, container: HTMLElement) {
        const blockAllFocusEvents = (event: Event) => {
            if (!this.focusLockActive) return;
            if (event.target === textarea || textarea.contains(event.target as Node)) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            setTimeout(() => textarea.focus(), 0);
        };

        const criticalEvents = [
            'mousedown', 'mouseup', 'click', 'dblclick',
            'focus', 'blur', 'focusin', 'focusout',
            'keydown', 'keyup', 'keypress'
        ];

        criticalEvents.forEach(eventType => {
            document.addEventListener(eventType, blockAllFocusEvents, { capture: true });
        });

        const existingEventCleanup = (textarea as any)._eventCleanup || (() => {});
        (textarea as any)._eventCleanup = () => {
            existingEventCleanup();
            criticalEvents.forEach(eventType => {
                document.removeEventListener(eventType, blockAllFocusEvents, { capture: true });
            });
        };
    }

    overrideObsidianFocus(textarea: HTMLTextAreaElement) {
        this.originalSetActiveLeaf = this.app.workspace.setActiveLeaf;

        this.app.workspace.setActiveLeaf = (leaf: WorkspaceLeaf, ...args: any[]) => {
            console.log("Enhanced Continuous Mode: Blocked setActiveLeaf to maintain focus.");
            textarea.focus();
        };
    }

    emergencyFocusRecovery(textarea: HTMLTextAreaElement) {
        if (!this.focusLockActive || !textarea) return;

        const recovery = () => {
            if (!this.focusLockActive) return;
            if (document.activeElement !== textarea) {
                console.log('Emergency focus recovery triggered');
                textarea.focus();
                requestAnimationFrame(recovery);
            }
        };

        requestAnimationFrame(recovery);
    }
}