import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, Notice, MarkdownView } from 'obsidian';
import EnhancedContinuousModePlugin from '../main';

export const TABS_VIEW_TYPE = "tabs-continuous-view";

interface ActiveEditor {
    file: TFile;
    container: Element;
    leaf: WorkspaceLeaf | null;
    markdownView?: MarkdownView;
    editorElement?: Element;
    originalParent?: Element;
    handlers?: (() => void)[];
    fallbackElement?: HTMLTextAreaElement;
    cleanup?: () => void;
    overlay?: HTMLElement;
    scrollCleanup?: () => void;
    clickCleanup?: () => void;
    selectiveCleanup?: () => void;
}

export class TabsContinuousView extends ItemView {
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

    private activeEditor: ActiveEditor | null = null;
    private clickOutsideHandler: ((event: MouseEvent | KeyboardEvent) => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: EnhancedContinuousModePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.setupIntersectionObserver();
    }

    getViewType(): string {
        return TABS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return `Continuous: Open Tabs (${this.allFiles.length})`;
    }

    async onOpen() {
        console.log("🟢 TabsContinuousView.onOpen");
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('enhanced-continuous-container');
        container.addClass('tabs-continuous-view');

        this.createScrollElements(container);
        this.setupActiveFileObserver();

        await this.loadInitialState();
        this.setupWorkspaceListeners();
    }

    async onClose() {
        try {
            await this.cleanupActiveEditor();

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

            if (this.clickOutsideHandler) {
                document.removeEventListener('click', this.clickOutsideHandler, true);
                document.removeEventListener('keydown', this.clickOutsideHandler, true);
                this.clickOutsideHandler = null;
            }

        } catch (error) {
            console.error('View closure cleanup error:', error);
        }
    }

    private async loadInitialState(): Promise<void> {
        // Get all open markdown tabs
        const tabs = this.app.workspace.getLeavesOfType("markdown");
        const tabFiles = tabs
            .map((leaf: any) => leaf.view?.file)
            .filter((f: TFile | undefined) => f && f.extension === "md") as TFile[];

        // Remove duplicates
        const uniqueFiles = Array.from(new Set(tabFiles.map(f => f.path)))
            .map(path => tabFiles.find(f => f.path === path)!);

        this.allFiles = uniqueFiles;

        if (this.allFiles.length === 0) {
            this.contentContainer!.setText("No open markdown tabs");
            new Notice("No open tabs to show in continuous view");
            return;
        }

        await this.loadInitialFiles();
        new Notice(`Loaded ${this.allFiles.length} open files`);
    }

    private setupWorkspaceListeners(): void {
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async () => {
                const tabs = this.app.workspace.getLeavesOfType("markdown");
                const tabFiles = tabs
                    .map((leaf: any) => leaf.view?.file)
                    .filter((f: TFile | undefined) => f && f.extension === "md") as TFile[];

                const uniqueFiles = Array.from(new Set(tabFiles.map(f => f.path)))
                    .map(path => tabFiles.find(f => f.path === path)!);

                if (JSON.stringify(uniqueFiles.map(f => f.path)) !== JSON.stringify(this.allFiles.map(f => f.path))) {
                    console.log("🔄 Tabs changed, refreshing file list");
                    this.allFiles = uniqueFiles;
                    await this.loadInitialFiles();
                }
            })
        );
    }

    // Copied methods from EnhancedContinuousView

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

    private async renderFileContent(file: TFile, contentDiv: Element): Promise<void> {
        if (!this.isHTMLElement(contentDiv)) return;
        contentDiv.empty();
        const fileContent = await this.app.vault.cachedRead(file);
        await MarkdownRenderer.render(this.app, fileContent, contentDiv, file.path, this);
    }

    private isHTMLElement(element: Element | null): element is HTMLElement {
        return element instanceof HTMLElement;
    }

    private async createFileElement(file: TFile): Promise<HTMLElement> {
        const container = document.createElement('div');
        container.classList.add('file-container');
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

            // Remove from loadedFiles array
            this.loadedFiles = this.loadedFiles.filter(f => f.path !== file.path);
            this.allFiles = this.allFiles.filter(f => f.path !== file.path);

            container.remove();

            if (this.activeFileObserver) {
                this.activeFileObserver.unobserve(container);
            }

            this.leaf.view.containerEl.querySelector('.view-header-title')!.textContent = this.getDisplayText();
        });

        const content = container.createDiv('file-content');
        content.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.switchToEditorView(file, container);
        });
        await this.renderFileContent(file, content);

        console.debug(`Created element for file: ${file.path}`);
        return container;
    }

    async switchToEditorView(file: TFile, fileContainer: Element) {
        if (this.activeEditor) {
            await this.cleanupActiveEditor();
        }

        const fileContent = fileContainer.querySelector('.file-content');
        if (!fileContent || !this.isHTMLElement(fileContent)) return;

        try {
            const hiddenLeaf = this.app.workspace.createLeafInParent(
                this.app.workspace.rootSplit,
                -1
            );

            const containerEl = (hiddenLeaf as any).containerEl;
            if (this.isHTMLElement(containerEl)) {
                containerEl.setAttribute('style', `
                    position: absolute !important;
                    left: -9999px !important;
                    top: -9999px !important;
                    width: 1px !important;
                    height: 1px !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                    pointer-events: none !important;
                `);
            }

            await hiddenLeaf.openFile(file);

            const view = hiddenLeaf.view;
            if (!(view instanceof MarkdownView) || !view.editor) {
                hiddenLeaf.detach();
                return this.createFallbackEditor(file, fileContent, fileContainer);
            }

            const contentEl = view.contentEl;
            const editorElement = contentEl?.querySelector('.cm-editor, .markdown-source-view');

            if (!editorElement || !this.isHTMLElement(editorElement)) {
                hiddenLeaf.detach();
                return this.createFallbackEditor(file, fileContent, fileContainer);
            }

            fileContent.empty();
            const editorWrapper = fileContent.createDiv('native-editor-wrapper');

            const editorHeader = editorWrapper.createDiv('editor-header');
            editorHeader.setAttribute('style', `
                display: flex;
                justify-content: flex-end;
                padding: 4px;
                border-bottom: 1px solid var(--background-modifier-border);
                background-color: var(--background-secondary);
            `);

            const exitButton = editorHeader.createEl('button', {
                cls: 'exit-editor-button',
                attr: {
                    'aria-label': 'Exit Editor',
                    style: `
                        display: flex;
                        align-items: center;
                        padding: 4px 8px;
                        border-radius: 4px;
                        color: var(--text-muted);
                        background-color: var(--background-secondary);
                        border: 1px solid var(--background-modifier-border);
                        cursor: pointer;
                        font-size: 12px;
                    `
                }
            });
            exitButton.innerHTML = 'Exit';

            exitButton.addEventListener('click', async () => {
                const content = view.editor.getValue();
                await this.app.vault.modify(file, content);
                await this.cleanupActiveEditor();
                await this.renderFileContent(file, fileContent);
            });

            editorWrapper.setAttribute('style', `
                width: 100%;
                max-height: 400px;
                overflow: hidden !important;
                border: 2px solid var(--interactive-accent);
                border-radius: 4px;
                position: relative;
                z-index: 1000000;
                background-color: var(--background-primary);
            `);

            const editorContainer = editorWrapper.createDiv('editor-container');
            editorContainer.setAttribute('style', `
                width: 100%;
                max-height: 358px;
                overflow: auto !important;
            `);

            editorElement.setAttribute('style', `
                width: 100%;
                min-height: 200px;
                max-height: none;
                opacity: 0;
                transition: opacity 0.2s ease-in-out;
            `);

            editorElement.detach();
            editorContainer.appendChild(editorElement);

            const overlay = createDiv('focus-trap-overlay');
            overlay.setAttribute('style', `
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                z-index: 999998 !important;
                background: transparent;
                pointer-events: none;
            `);
            document.body.appendChild(overlay);

            this.activeEditor = {
                file: file,
                container: fileContainer,
                leaf: hiddenLeaf,
                markdownView: view,
                editorElement: editorElement,
                originalParent: contentEl,
                overlay: overlay
            };

            this.setupEditorExitHandlers(view, fileContainer, file, overlay);

            requestAnimationFrame(() => {
                editorElement.style.transition = 'opacity 0.2s ease-in-out';
                editorElement.style.opacity = '1';
            });

            setTimeout(() => {
                if (view.editor && view.editor.focus) {
                    view.editor.focus();
                }
            }, 250);

            fileContainer.addClass('editing-active');

        } catch (error) {
            console.error('Silent editor creation failed:', error);
            if (fileContent) {
                this.createFallbackEditor(file, fileContent, fileContainer);
            }
        }
    }

    private createFallbackEditor(file: TFile, fileContent: Element, fileContainer: Element): void {
        if (!this.isHTMLElement(fileContent)) return;

        fileContent.empty();
        const container = fileContent.createDiv('fallback-editor-container');
        const textarea = container.createEl('textarea', {
            cls: 'fallback-inline-editor',
            attr: {
                placeholder: 'Loading content...',
                style: 'width: 100%; min-height: 200px; resize: vertical;'
            }
        });

        const overlay = createDiv('focus-trap-overlay');
        overlay.setAttribute('style', `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            z-index: 999998 !important;
            background: transparent;
            pointer-events: auto;
        `);
        document.body.appendChild(overlay);

        this.app.vault.read(file).then(content => {
            textarea.value = content;
            textarea.focus();
        });

        const saveAndExit = async () => {
            try {
                await this.app.vault.modify(file, textarea.value);
                await this.cleanupActiveEditor();

                if (this.isHTMLElement(fileContent)) {
                    await this.renderFileContent(file, fileContent);
                }
            } catch (error) {
                new Notice('Failed to save file');
            }
        };

        const keyboardHandler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                saveAndExit();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                saveAndExit();
            }
        };

        const clickOutsideHandler = (event: MouseEvent) => {
            if (event.target === overlay) {
                saveAndExit();
            }
        };

        textarea.addEventListener('keydown', keyboardHandler);
        overlay.addEventListener('click', clickOutsideHandler);
        document.addEventListener('keydown', keyboardHandler);

        this.activeEditor = {
            file: file,
            container: fileContainer,
            leaf: null,
            fallbackElement: textarea,
            overlay: overlay,
            handlers: [
                () => textarea.removeEventListener('keydown', keyboardHandler),
                () => overlay.removeEventListener('click', clickOutsideHandler),
                () => document.removeEventListener('keydown', keyboardHandler),
                () => {
                    if (overlay.parentNode) {
                        overlay.parentNode.removeChild(overlay);
                    }
                    fileContainer.removeClass('editing-active');
                }
            ],
            cleanup: () => textarea.remove()
        };

        fileContainer.addClass('editing-active');
    }

    private setupEditorExitHandlers(view: MarkdownView, fileContainer: Element, file: TFile, overlay: HTMLElement) {
        const saveAndExit = async () => {
            try {
                const content = view.editor.getValue();
                await this.app.vault.modify(file, content);
                await this.cleanupActiveEditor();

                const fileContent = fileContainer.querySelector('.file-content');
                if (fileContent && this.isHTMLElement(fileContent)) {
                    await this.renderFileContent(file, fileContent);
                }
            } catch (error) {
                new Notice('Failed to save file');
            }
        };

        const selectiveHandler = (event: Event) => {
            const target = event.target as Element;
            const editorElement = this.activeEditor?.editorElement;

            if (!editorElement) return;
            if (editorElement.contains(target)) return;
            if (event.type === 'wheel' || event.type === 'scroll') return;

            const isInContainer =
                target.closest('.file-content-container') ||
                target.closest('.enhanced-continuous-container') ||
                this.contentContainer?.contains(target);

            if (isInContainer) {
                if (event.type === 'wheel' || event.type === 'scroll') return;
                if (event.type === 'mousedown' || event.type === 'click') {
                    requestAnimationFrame(() => {
                        if (editorElement instanceof HTMLElement && editorElement.focus) {
                            editorElement.focus();
                        }
                    });
                    return;
                }
            }

            if (event instanceof KeyboardEvent) {
                if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
                    event.preventDefault();
                    event.stopPropagation();
                    saveAndExit();
                    return;
                }
                if (!editorElement.contains(target)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (editorElement instanceof HTMLElement && editorElement.focus) {
                        editorElement.focus();
                    }
                    return;
                }
            }

            if (event.type === 'mousedown' && event.target === overlay) {
                event.preventDefault();
                event.stopPropagation();
                saveAndExit();
                return;
            }

            if (event.type === 'mousedown' && !editorElement.contains(target)) {
                requestAnimationFrame(() => {
                    if (editorElement instanceof HTMLElement && editorElement.focus) {
                        editorElement.focus();
                    }
                });
            }
        };

        overlay.style.pointerEvents = 'none';

        const eventTypes = ['keydown', 'mousedown', 'click'];
        eventTypes.forEach(eventType => {
            document.addEventListener(eventType, selectiveHandler, {
                capture: true,
                passive: false
            });
        });

        if (this.activeEditor) {
            this.activeEditor.handlers = [
                ...eventTypes.map(eventType => () =>
                    document.removeEventListener(eventType, selectiveHandler, { capture: true })
                ),
                () => {
                    if (overlay.parentNode) {
                        overlay.parentNode.removeChild(overlay);
                    }
                    fileContainer.removeClass('editing-active');
                }
            ];
        }
    }

    async cleanupActiveEditor() {
        if (!this.activeEditor) return;

        try {
            if (this.activeEditor.handlers) {
                this.activeEditor.handlers.forEach(handler => {
                    try { handler(); } catch (e) { console.error('Handler cleanup error:', e); }
                });
            }

            const cleanupFunctions = [
                this.activeEditor.cleanup,
                this.activeEditor.scrollCleanup,
                this.activeEditor.clickCleanup,
                this.activeEditor.selectiveCleanup
            ];

            for (const cleanup of cleanupFunctions) {
                if (cleanup) {
                    try { cleanup(); } catch (e) { console.error('Specific cleanup error:', e); }
                }
            }

            if (this.activeEditor.editorElement && this.activeEditor.originalParent) {
                try {
                    if (this.activeEditor.editorElement instanceof HTMLElement) {
                        this.activeEditor.editorElement.style.opacity = '0';
                        this.activeEditor.editorElement.style.position = '';
                        this.activeEditor.editorElement.style.left = '';
                    }
                    this.activeEditor.editorElement.detach();
                    this.activeEditor.originalParent.appendChild(this.activeEditor.editorElement);
                } catch (e) {
                    console.error('Editor restoration error:', e);
                }
            }

            if (this.activeEditor.leaf) {
                try {
                    const containerEl = (this.activeEditor.leaf as any).containerEl;
                    if (containerEl) {
                        containerEl.style.display = '';
                        containerEl.style.position = '';
                        containerEl.style.left = '';
                        containerEl.style.top = '';
                        containerEl.style.opacity = '';
                        containerEl.style.visibility = '';
                    }
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    const workspace = this.app.workspace;
                    if (workspace.activeLeaf === this.activeEditor.leaf) {
                        workspace.activeLeaf = null;
                    }
                    this.activeEditor.leaf.detach();
                } catch (e) {
                    console.error('Leaf cleanup error:', e);
                }
            }

            if (this.activeEditor.overlay && this.activeEditor.overlay.parentNode) {
                this.activeEditor.overlay.parentNode.removeChild(this.activeEditor.overlay);
            }

            if (this.activeEditor.container) {
                this.activeEditor.container.removeClass('editing-active');
            }

        } catch (error) {
            console.error('Complete cleanup error:', error);
            if (this.activeEditor.leaf) {
                try { this.activeEditor.leaf.detach(); } catch (e) {}
            }
        }

        this.activeEditor = null;
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
