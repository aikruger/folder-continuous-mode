import { ItemView, WorkspaceLeaf, TFile, TFolder, MarkdownRenderer, Notice, MarkdownView, WorkspaceTabs, WorkspaceSplit } from 'obsidian';
import EnhancedContinuousModePlugin from './main';
import { FolderSuggestionModal } from './folderModal';

export const ENHANCED_CONTINUOUS_VIEW_TYPE = 'enhanced-continuous-view';

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
    private dropZone: HTMLElement;

    private activeEditor: ActiveEditor | null = null;
    private clickOutsideHandler: ((event: MouseEvent | KeyboardEvent) => void) | null = null;

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

    getIcon(): string {
        return 'scroll'; // Use Obsidian's built-in scroll icon
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('enhanced-continuous-container');

        this.createScrollElements(container);
        this.setupActiveFileObserver();

        if (!this.currentFolder) {
            this.showFolderSelector(container);
        }
    }

    async onClose() {
        // Enhanced cleanup on view closure
        try {
            // Clean up any active editor first
            await this.cleanupActiveEditor();

            // Clean up observers
            if (this.intersectionObserver) {
                this.intersectionObserver.disconnect();
                // Create new disconnected observer to satisfy type
                this.intersectionObserver = new IntersectionObserver(() => {});
                this.intersectionObserver.disconnect();
            }
            if (this.activeFileObserver) {
                this.activeFileObserver.disconnect();
                // Create new disconnected observer to satisfy type
                this.activeFileObserver = new IntersectionObserver(() => {});
                this.activeFileObserver.disconnect();
            }

            // Clean up highlight
            if (this.lastHighlighted) {
                this.lastHighlighted.removeClass('is-active-in-continuous-view');
                this.lastHighlighted = null;
            }

            // Reset state
            this.loadedFiles = [];
            this.allFiles = [];
            this.currentFolder = null;
            this.currentIndex = 0;

            // Clean up container
            if (this.contentContainer) {
                this.contentContainer.empty();
                // Create empty div to satisfy type
                this.contentContainer = createDiv();
            }

            // Remove any remaining event listeners
            if (this.clickOutsideHandler) {
                document.removeEventListener('click', this.clickOutsideHandler, true);
                document.removeEventListener('keydown', this.clickOutsideHandler, true);
                this.clickOutsideHandler = null;
            }

        } catch (error) {
            console.error('View closure cleanup error:', error);
        }
    }

    private debounce(func: Function, wait: number) {
        // Debounce function to limit the rate of function execution
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
            rootMargin: "50px 0px", // Reduced for better triggering
            threshold: 0.1
        };
        
        this.intersectionObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    console.debug(`Intersection detected for ${entry.target.className}`, {
                        ratio: entry.intersectionRatio,
                        isTop: entry.target === this.topSentinel,
                        isBottom: entry.target === this.bottomSentinel
                    });
                    
                    // CRITICAL FIX: Use proper IF statements
                    if (entry.target === this.topSentinel && this.currentIndex > 0) {
                        console.debug("Loading previous files...");
                        this.loadPreviousFilesDebounced();
                    }
                    
                    if (entry.target === this.bottomSentinel) {
                        console.debug("Loading next files...");
                        this.loadNextFilesDebounced();
                    }
                }
            });
        }, options);
    }

    private setupActiveFileObserver() {
        const options = {
            root: null, // Use viewport
            rootMargin: "0px 0px -40% 0px", // Top 60% of viewport triggers highlight
            threshold: [0.1, 0.3, 0.5, 0.7]
        };
        
        this.activeFileObserver = new IntersectionObserver((entries) => {
            // Find the most visible file
            let mostVisible: Element | null = null;
            let maxRatio = 0;
            
            entries.forEach((entry) => {
                if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
                    maxRatio = entry.intersectionRatio;
                    mostVisible = entry.target;
                }
            });
            
            if (mostVisible) {
                const el = mostVisible as HTMLElement;
                console.debug(`File intersection detected: ${el.dataset.fileName}`, {
                    ratio: maxRatio
                });
                
                // Small delay to ensure stable intersection
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
        if (!fileName) {
            console.debug('No filename found for highlighting');
            return;
        }
        
        console.debug(`Attempting to highlight file: ${fileName}`);
        
        // Remove previous highlight
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('is-active-in-continuous-view');
            this.lastHighlighted = null;
        }
        
        // Find file explorer with retry
        const findAndHighlight = (attempt = 0) => {
            const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')?.[0];
            
            if (!explorerLeaf) {
                if (attempt < 3) {
                    setTimeout(() => findAndHighlight(attempt + 1), 200);
                } else {
                    console.debug('File explorer not found after retries');
                }
                return;
            }
            
            // Try multiple selector patterns
            const selectors = [
                `.nav-file-title[data-path="${fileName}"]`,
                `.nav-file-title-content[data-path="${fileName}"]`,
                `.nav-file-title`
            ];
            
            let navElement: HTMLElement | null = null;
            
            // Try each selector (except the last generic one)
            for (const selector of selectors.slice(0, -1)) {
                try {
                    const found = explorerLeaf.view.containerEl.querySelector(selector) as HTMLElement | null;
                    if (found) {
                        navElement = found;
                        console.debug(`Found with selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    console.debug(`Selector failed: ${selector}`, e);
                }
            }
            
            // Fallback: search by text content
            if (!navElement) {
                const baseName = fileName.split('/').pop()?.replace('.md', '');
                const allNavTitles = explorerLeaf.view.containerEl.querySelectorAll('.nav-file-title');
                
                for (const navTitle of Array.from(allNavTitles)) {
                    if ((navTitle as HTMLElement).textContent?.trim() === baseName) {
                        navElement = navTitle as HTMLElement;
                        console.debug(`Found by text content: ${baseName}`);
                        break;
                    }
                }
            }
            
            if (navElement) {
                navElement.addClass('is-active-in-continuous-view');
                this.lastHighlighted = navElement;
                
                try {
                    navElement.scrollIntoView({ 
                        block: 'center', 
                        behavior: 'smooth' 
                    });
                    console.debug(`Successfully highlighted: ${fileName}`);
                } catch (error) {
                    console.debug(`Error scrolling: ${error}`);
                }
            } else {
                console.debug(`Nav element not found for: ${fileName}`);
            }
        };
        
        findAndHighlight();
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
        const fileCount = Math.min(this.plugin.settings.initialFileCount, this.allFiles.length);
        this.currentIndex = 0;
        this.loadedFiles = this.allFiles.slice(0, fileCount);
        
        await this.renderFiles();
        this.updateScrollElements();
        
        // Enhanced debug with validation
        setTimeout(() => {
            if (!this.validateObservers()) {
                console.error("Observer validation failed - recreating...");
                this.setupIntersectionObserver();
                this.setupActiveFileObserver();
                this.updateScrollElements();
            }
            this.debugIntersectionState();
        }, 300); // Increased delay
    }

    private validateObservers(): boolean {
        let valid = true;
        
        if (!this.intersectionObserver) {
            console.error("Intersection observer is null");
            valid = false;
        }
        
        if (!this.activeFileObserver) {
            console.error("Active file observer is null");
            valid = false;
        }
        
        if (!this.topSentinel || !this.bottomSentinel) {
            console.error("Sentinel elements missing");
            valid = false;
        }
        
        if (!this.contentContainer) {
            console.error("Content container missing");
            valid = false;
        }
        
        return valid;
    }

    private debugIntersectionState() {
        console.debug("=== Intersection Observer Debug ===");
        console.debug("Current Index:", this.currentIndex);
        console.debug("Loaded Files:", this.loadedFiles.length);
        console.debug("Total Files:", this.allFiles.length);
        console.debug("Top Sentinel exists:", !!this.topSentinel);
        console.debug("Bottom Sentinel exists:", !!this.bottomSentinel);
        console.debug("Intersection Observer exists:", !!this.intersectionObserver);
        console.debug("Active File Observer exists:", !!this.activeFileObserver);
        
        const totalAccessible = this.currentIndex + this.loadedFiles.length;
        console.debug("Total Accessible:", totalAccessible);
        console.debug("Has More Files:", totalAccessible < this.allFiles.length);
        console.debug("===================================");
    }

    private async loadNextFiles() {
        console.debug('LoadNextFiles triggered', {
            currentIndex: this.currentIndex,
            loadedFilesCount: this.loadedFiles.length,
            totalFiles: this.allFiles.length,
            maxFileCount: this.plugin.settings.maxFileCount
        });
        
        // Check if we're already at the end
        const totalLoadedFromStart = this.currentIndex + this.loadedFiles.length;
        if (totalLoadedFromStart >= this.allFiles.length) {
            console.debug('Already at end of files');
            return;
        }
        
        // Calculate how many files to load
        const loadCount = this.plugin.settings.loadUnloadCount;
        const startIndex = totalLoadedFromStart;
        const endIndex = Math.min(startIndex + loadCount, this.allFiles.length);
        const filesToLoad = this.allFiles.slice(startIndex, endIndex);
        
        if (filesToLoad.length === 0) {
            console.debug('No files to load');
            return;
        }
        
        // If we're at capacity, remove files from the beginning
        const currentCapacity = this.loadedFiles.length;
        const maxCapacity = this.plugin.settings.maxFileCount;
        
        if (currentCapacity + filesToLoad.length > maxCapacity) {
            const removeCount = Math.min(
                this.plugin.settings.loadUnloadCount,
                currentCapacity + filesToLoad.length - maxCapacity
            );
            
            console.debug(`Removing ${removeCount} files from beginning`);
            
            // Remove from DOM and array
            const filesToRemove = this.loadedFiles.splice(0, removeCount);
            this.removeFilesFromDOM(filesToRemove);
            this.currentIndex += removeCount;
        }
        
        // Add new files
        console.debug(`Loading ${filesToLoad.length} files from index ${startIndex}`);
        await this.appendFilesToDOM(filesToLoad);
        this.loadedFiles.push(...filesToLoad);
        
        // Update scroll elements
        this.updateScrollElements();
    }

    private async loadPreviousFiles() {
        console.debug('LoadPreviousFiles triggered', {
            currentIndex: this.currentIndex,
            loadedFilesCount: this.loadedFiles.length,
            totalFiles: this.allFiles.length,
            maxFileCount: this.plugin.settings.maxFileCount
        });

        if (this.currentIndex === 0) {
            console.debug('Already at start of files');
            return;
        }

        // Calculate how many files to load
        const loadCount = this.plugin.settings.loadUnloadCount;
        const newIndex = Math.max(0, this.currentIndex - loadCount);
        const filesToLoad = this.allFiles.slice(newIndex, this.currentIndex);

        if (filesToLoad.length === 0) {
            console.debug('No files to load');
            return;
        }

        // If we're at capacity, remove files from the end
        const currentCapacity = this.loadedFiles.length;
        const maxCapacity = this.plugin.settings.maxFileCount;

        if (currentCapacity + filesToLoad.length > maxCapacity) {
            const removeCount = Math.min(
                this.plugin.settings.loadUnloadCount,
                currentCapacity + filesToLoad.length - maxCapacity
            );

            console.debug(`Removing ${removeCount} files from end`);
            const filesToRemove = this.loadedFiles.splice(this.loadedFiles.length - removeCount, removeCount);
            this.removeFilesFromDOM(filesToRemove);
        }

        // Add new files
        console.debug(`Loading ${filesToLoad.length} files from index ${newIndex}`);
        this.currentIndex = newIndex;
        await this.prependFilesToDOM(filesToLoad);
        this.loadedFiles.unshift(...filesToLoad);

        // Update scroll elements
        this.updateScrollElements();
    }

    private async renderFiles() {
        this.contentContainer.empty();
        await this.appendFilesToDOM(this.loadedFiles);
    }

    private async renderFileContent(file: TFile, contentDiv: Element): Promise<void> {
        if (!this.isHTMLElement(contentDiv)) {
            console.error('contentDiv is not an HTMLElement');
            return;
        }
        
        contentDiv.empty();
        const fileContent = await this.app.vault.cachedRead(file);
        await MarkdownRenderer.render(this.app, fileContent, contentDiv, file.path, this);
    }

    private isHTMLElement(element: Element | null): element is HTMLElement {
        return element instanceof HTMLElement;
    }

    private async createFileElement(file: TFile): Promise<HTMLElement> {
        const container = createDiv('file-container');
        container.dataset.fileName = file.path;
        
        // Create drop zone ABOVE this file
        const dropZoneAbove = container.createDiv('file-drop-zone-between');
        (dropZoneAbove as HTMLElement).dataset.dropPosition = 'above';
        (dropZoneAbove as HTMLElement).dataset.targetFile = file.path;
        (dropZoneAbove as HTMLElement).style.cssText = `
            height: 8px;
            margin: 4px 0;
            border: 2px dashed transparent;
            border-radius: 4px;
            opacity: 0;
            transition: all 0.2s ease-in-out;
            background: transparent;
            display: none;
            text-align: center;
            font-size: 10px;
            color: var(--text-muted);
            line-height: 8px;
        `;
        dropZoneAbove.textContent = '↓ Drop here ↓';
        
        // File header with content wrapper (adds missing exclude button)
        const header = container.createDiv('file-header');
        const headerContent = header.createDiv('file-header-content');
        
        const titleElement = headerContent.createEl('h2', {
            text: file.basename,
            cls: 'file-title'
        });
        
        // Draggable functionality for title
        (titleElement as HTMLElement).draggable = true;
        (titleElement as HTMLElement).style.cursor = 'grab';
        (titleElement as HTMLElement).style.userSelect = 'none';
        
        titleElement.addEventListener('dragstart', (e: DragEvent) => {
            if (!e.dataTransfer) return;
            console.debug('Drag started for file:', file.path);
            const wikiLink = `[[${file.basename}]]`;
            console.debug('Generated wiki link:', wikiLink);
            e.dataTransfer.setData('text/plain', wikiLink);
            e.dataTransfer.effectAllowed = 'copy';
            (titleElement as HTMLElement).style.cursor = 'grabbing';
            (titleElement as HTMLElement).style.opacity = '0.7';
        });
        
        titleElement.addEventListener('dragend', (_e: DragEvent) => {
            console.debug('Drag ended for file:', file.path);
            (titleElement as HTMLElement).style.cursor = 'grab';
            (titleElement as HTMLElement).style.opacity = '1';
        });
        
        // Click handler
        titleElement.addEventListener('click', (e: MouseEvent) => {
            // Only handle click if not dragging
            if (!e.defaultPrevented) {
                this.app.workspace.getLeaf('tab').openFile(file);
            }
        });
        
        // Visual feedback for drag capability
        titleElement.addEventListener('mouseenter', () => {
            (titleElement as HTMLElement).style.cursor = 'grab';
        });
        titleElement.addEventListener('mouseleave', () => {
            (titleElement as HTMLElement).style.cursor = 'pointer';
        });
        
        const excludeButton = headerContent.createEl('button', {
            text: 'X',
            cls: 'exclude-file-button'
        });
        excludeButton.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.excludeFile(file);
        });

        // File content with double-click handler
        const fileContent = container.createDiv('file-content');
        fileContent.addEventListener('dblclick', (e: MouseEvent) => {
            console.debug('Double-click detected on file content!', e);
            e.preventDefault();
            e.stopPropagation();
            this.switchToEditorView(file, container);
        });

        await this.renderFileContent(file, fileContent);
        
        // Setup drop zone for this file
        this.setupIndividualDropZone(dropZoneAbove as HTMLElement, container as HTMLElement);
        
        console.debug(`Created element for file: ${file.path}`);
        return container;
    }

    // Show folder selector UI
    private showFolderSelector(container: HTMLElement) {
        const selectorContainer = container.createDiv('folder-selector-container');
        selectorContainer.createEl('h3', { text: 'Select a folder to scroll through' });
        const button = selectorContainer.createEl('button', { text: 'Choose Folder', cls: 'mod-cta' });
        button.onclick = () => new FolderSuggestionModal(this.app, (folder: TFolder) => (this.plugin as any).activateView(folder)).open();
    }

    // Clean up any active inline editor/resources
    private async cleanupActiveEditor() {
        if (!this.activeEditor) return;
        try {
            // Remove overlay if any
            if (this.activeEditor.overlay && this.activeEditor.overlay.parentNode) {
                this.activeEditor.overlay.parentNode.removeChild(this.activeEditor.overlay);
            }
            // Call any registered handlers
            if (this.activeEditor.handlers) {
                this.activeEditor.handlers.forEach(h => { try { h(); } catch {} });
            }
            // Move editor element back if possible
            const editorEl = this.activeEditor.editorElement as HTMLElement | undefined;
            const originalParent = this.activeEditor.originalParent as HTMLElement | undefined;
            if (editorEl && originalParent && !originalParent.contains(editorEl)) {
                try {
                    originalParent.appendChild(editorEl);
                } catch {}
            }
            // Detach hidden leaf
            if (this.activeEditor.leaf) {
                try { this.activeEditor.leaf.detach(); } catch {}
            }
            // Remove editing class
            if (this.activeEditor.container && (this.activeEditor.container as any).removeClass) {
                (this.activeEditor.container as any).removeClass('editing-active');
            }
        } catch (e) {
            console.error('Cleanup editor error:', e);
        }
        this.activeEditor = null;
    }

    // General resource cleanup when changing folders
    private async cleanupResources() {
        await this.cleanupActiveEditor();
        try {
            if (this.intersectionObserver) this.intersectionObserver.disconnect();
            if (this.activeFileObserver) this.activeFileObserver.disconnect();
        } catch {}
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('is-active-in-continuous-view');
            this.lastHighlighted = null;
        }
        this.loadedFiles = [];
        this.allFiles = [];
        this.currentFolder = null;
        this.currentIndex = 0;
        if (this.contentContainer) this.contentContainer.empty();
    }

    // Update view header text if folder changes
    private updateDisplayText() {
        const newDisplayText = this.currentFolder ? `Continuous: ${this.currentFolder.name}` : 'Enhanced Continuous View';
        if (this.getDisplayText() !== newDisplayText) (this.leaf as any).rebuildView?.();
    }

    private showEmptyFolderMessage() {
        if (!this.contentContainer) return;
        this.contentContainer.empty();
        this.contentContainer.createEl('p', { text: 'This folder contains no markdown files.' });
    }

    // Create scroll-related elements and drop zone container
    private createScrollElements(container: HTMLElement) {
        // Remove the global drop zone completely - inter-file zones handle all scenarios
        
        // Keep existing scroll indicators and sentinels
        this.topIndicator = container.createDiv({
            cls: 'scroll-indicator top-indicator',
            text: '⇈'
        });
        this.topIndicator.style.display = 'none';
        
        this.topSentinel = container.createDiv({
            cls: 'scroll-sentinel top-sentinel'
        });
        this.topSentinel.setAttr('style', 'height: 1px; width: 100%; opacity: 0;');
        
        this.contentContainer = container.createDiv('file-content-container');
        
        this.bottomSentinel = container.createDiv({
            cls: 'scroll-sentinel bottom-sentinel'
        });
        this.bottomSentinel.setAttr('style', 'height: 1px; width: 100%; opacity: 0;');
        
        this.bottomIndicator = container.createDiv({
            cls: 'scroll-indicator bottom-indicator',
            text: '⇊'
        });
        this.bottomIndicator.style.display = 'none';
        
        // Keep existing intersection observer setup
        if (this.intersectionObserver) {
            this.intersectionObserver.observe(this.bottomSentinel);
            this.bottomIndicator.style.display = 'block';
        }
    }

    // Update which sentinels are observed based on current window
    private updateScrollElements() {
        if (!this.intersectionObserver) return;
        this.intersectionObserver.disconnect();

        // Top sentinel
        if (this.currentIndex > 0) {
            this.intersectionObserver.observe(this.topSentinel);
            this.topIndicator.style.display = 'block';
        } else {
            this.topIndicator.style.display = 'none';
        }

        // Bottom sentinel
        const totalAccessible = this.currentIndex + this.loadedFiles.length;
        const hasMore = totalAccessible < this.allFiles.length;
        if (hasMore) {
            this.intersectionObserver.observe(this.bottomSentinel);
            this.bottomIndicator.style.display = 'block';
        } else {
            this.bottomIndicator.style.display = 'none';
        }
    }

    // Append a set of files to the DOM and register observers
    private async appendFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        for (const file of files) {
            const element = await this.createFileElement(file);
            fragment.appendChild(element);
        }
        this.contentContainer.appendChild(fragment);

        // Observe new elements
        files.forEach(f => {
            const el = this.contentContainer.querySelector(`[data-file-name="${f.path}"]`);
            if (el) this.activeFileObserver.observe(el);
        });
    }

    // Prepend a set of files to the DOM and register observers
    private async prependFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        for (const file of [...files].reverse()) {
            const element = await this.createFileElement(file);
            fragment.prepend(element);
        }
        this.contentContainer.prepend(fragment);

        files.forEach(f => {
            const el = this.contentContainer.querySelector(`[data-file-name="${f.path}"]`);
            if (el) this.activeFileObserver.observe(el);
        });
    }

    // Remove multiple files' elements from DOM
    private removeFilesFromDOM(files: TFile[]) {
        files.forEach(file => this.removeFileFromDOM(file.path));
    }

    // Remove a single file element
    private removeFileFromDOM(filePath: string) {
        const el = this.contentContainer.querySelector(`[data-file-name="${filePath}"]`);
        if (el) {
            if (this.activeFileObserver) this.activeFileObserver.unobserve(el);
            el.remove();
        }
    }

    // Exclude a file from view and data model
    private excludeFile(fileToExclude: TFile) {
        this.allFiles = this.allFiles.filter(f => f.path !== fileToExclude.path);
        this.loadedFiles = this.loadedFiles.filter(f => f.path !== fileToExclude.path);
        this.removeFileFromDOM(fileToExclude.path);
        new Notice(`"${fileToExclude.basename}" excluded from view.`);
        this.updateScrollElements();
    }

    // Switch to native Obsidian editor in-place
    private async switchToEditorView(file: TFile, container: Element) {
        if (this.activeEditor) await this.cleanupActiveEditor();
        const fileContent = container.querySelector('.file-content');
        if (!fileContent || !this.isHTMLElement(fileContent)) return;
        try {
            const leaf = this.app.workspace.createLeafInParent(this.app.workspace.rootSplit, -1);
            const leafContainer = (leaf as any).containerEl as HTMLElement | undefined;
            if (leafContainer && this.isHTMLElement(leafContainer)) {
                leafContainer.setAttribute('style', `position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;visibility:hidden;pointer-events:none;`);
            }
            await leaf.openFile(file);
            const markdownView = (leaf as any).view as MarkdownView;
            if (!(markdownView instanceof MarkdownView) || !(markdownView as any).editor) {
                console.error('Failed to get MarkdownView or editor');
                leaf.detach();
                return;
            }
            const originalParent = (markdownView as any).contentEl as HTMLElement | null | undefined;
            const editorElement = originalParent?.querySelector('.cm-editor, .markdown-source-view') as HTMLElement | null | undefined;
            if (!editorElement || !this.isHTMLElement(editorElement)) {
                console.error('Could not find valid editor element');
                leaf.detach();
                return;
            }
            fileContent.empty();
            const wrapper = fileContent.createDiv('native-editor-wrapper');
            const header = wrapper.createDiv('editor-header');
            header.setAttribute('style', 'display:flex;justify-content:flex-end;padding:4px;border-bottom:1px solid var(--background-modifier-border);background-color:var(--background-secondary);');
            const exitButton = header.createEl('button', { cls: 'exit-editor-button', attr: { 'aria-label': 'Exit Editor', style: 'display:flex;align-items:center;padding:4px 8px;border-radius:4px;color:var(--text-muted);background-color:var(--background-secondary);border:1px solid var(--background-modifier-border);cursor:pointer;font-size:12px;' } });
            exitButton.innerHTML = 'Exit';
            exitButton.addEventListener('click', async () => {
                const content = (markdownView as any).editor.getValue();
                await this.app.vault.modify(file, content);
                await this.cleanupActiveEditor();
                await this.renderFileContent(file, fileContent);
            });
            wrapper.setAttribute('style', 'width:100%;max-height:400px;overflow:hidden !important;border:2px solid var(--interactive-accent);border-radius:4px;position:relative;z-index:1000000;background-color:var(--background-primary);');
            const editorContainer = wrapper.createDiv('editor-container');
            editorContainer.setAttribute('style', 'width:100%;max-height:358px;overflow:auto !important;');
            editorElement.setAttribute('style', 'width:100%;min-height:200px;max-height:none;opacity:0;transition:opacity .2s ease-in-out;');
            try { (editorElement as any).detach ? (editorElement as any).detach() : editorElement.remove(); } catch { if (editorElement.parentElement) editorElement.parentElement.removeChild(editorElement); }
            editorContainer.appendChild(editorElement);
            const overlay = createDiv('focus-trap-overlay');
            overlay.setAttribute('style', 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:999998 !important;background:transparent;pointer-events:none;');
            document.body.appendChild(overlay);
            this.activeEditor = { file, container, leaf, markdownView, editorElement, originalParent: originalParent || undefined, overlay } as ActiveEditor;
            this.setupEditorExitHandlers(markdownView, container, file, overlay);
            requestAnimationFrame(() => { editorElement.style.opacity = '1'; });
            setTimeout(() => { if ((markdownView as any).editor?.focus) (markdownView as any).editor.focus(); }, 250);
            (container as HTMLElement).addClass('editing-active');
            exitButton.addEventListener('mouseenter', () => { exitButton.style.backgroundColor = 'var(--interactive-hover)'; });
            exitButton.addEventListener('mouseleave', () => { exitButton.style.backgroundColor = 'var(--background-secondary)'; });
        } catch (err) {
            console.error('Editor creation failed:', err);
        }
    }

    private setupEditorExitHandlers(markdownView: MarkdownView, container: Element, file: TFile, overlay: HTMLElement) {
        const exit = async () => {
            try { const content = (markdownView as any).editor.getValue(); await this.app.vault.modify(file, content); } catch {}
            await this.cleanupActiveEditor();
            const fileContent = container.querySelector('.file-content') as HTMLElement | null;
            if (fileContent) await this.renderFileContent(file, fileContent);
        };
        const onKeyDown = async (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); await exit(); } };
        const onClick = async (e: MouseEvent) => { const wrapper = (container as HTMLElement).querySelector('.native-editor-wrapper'); if (wrapper && !wrapper.contains(e.target as Node)) { await exit(); } };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onClick, true);
        const handlers: (() => void)[] = [ () => document.removeEventListener('keydown', onKeyDown, true), () => document.removeEventListener('mousedown', onClick, true) ];
        if (!this.activeEditor) this.activeEditor = { file, container, leaf: null } as any;
        if (this.activeEditor) this.activeEditor.handlers = handlers;
    }

    // Drag-and-drop header-only setup
    private setupIndividualDropZone(dropZone: HTMLElement, fileContainer: HTMLElement): void {
        const fileHeader = fileContainer.querySelector('.file-header') as HTMLElement | null;
        
        if (!fileHeader) {
            console.warn('File header not found for drop zone setup');
            return;
        }
        
        // Header drag enter - shows drop zone
        fileHeader.addEventListener('dragenter', (e: DragEvent) => {
            if (this.isDraggedFileCompatible(e)) {
                e.preventDefault();
                e.stopPropagation();
                
                dropZone.style.display = 'block';
                dropZone.style.opacity = '1';
                dropZone.style.borderColor = 'var(--interactive-accent)';
                dropZone.style.backgroundColor = 'var(--background-secondary)';
                
                console.debug(`Showing drop zone for: ${fileContainer.dataset.fileName}`);
            }
        });
        
        // CRITICAL: Add drag handlers to DROP ZONE itself
        dropZone.addEventListener('dragenter', (e: DragEvent) => {
            if (this.isDraggedFileCompatible(e)) {
                e.preventDefault();
                e.stopPropagation();
                console.debug('Drag entered drop zone');
            }
        });
        
        dropZone.addEventListener('dragover', (e: DragEvent) => {
            if (this.isDraggedFileCompatible(e)) {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                console.debug('Drag over drop zone');
            }
        });
        
        dropZone.addEventListener('dragleave', (e: DragEvent) => {
            // Only hide if leaving the drop zone completely
            const related = e.relatedTarget as Node | null;
            if (!related || !dropZone.contains(related)) {
                dropZone.style.display = 'none';
                dropZone.style.opacity = '0';
                console.debug('Drag left drop zone');
            }
        });
        
        // Enhanced drop handler with better logging
        dropZone.addEventListener('drop', async (e: DragEvent) => {
            console.debug('=== DROP EVENT FIRED ===');
            console.debug('Event:', e);
            console.debug('DataTransfer:', e.dataTransfer);
            console.debug('DataTransfer types:', e.dataTransfer?.types);
            
            if (this.isDraggedFileCompatible(e)) {
                e.preventDefault();
                e.stopPropagation();
                
                console.debug(`Drop on drop zone for: ${fileContainer.dataset.fileName}`);
                
                const targetFilePath = (dropZone as any).dataset?.targetFile as string | undefined;
                const position = (dropZone as any).dataset?.dropPosition as 'above' | 'below' | undefined;
                
                console.debug(`Target: ${targetFilePath}, Position: ${position}`);
                
                await this.handleFileDropAtPosition(e, targetFilePath, position);
                
                // Hide drop zone
                dropZone.style.display = 'none';
                dropZone.style.opacity = '0';
            } else {
                console.debug('Drop not compatible');
            }
        });
        
        // ADDITIONAL: Add drag handlers to file header for better UX
        fileHeader.addEventListener('dragover', (e: DragEvent) => {
            if (this.isDraggedFileCompatible(e)) {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            }
        });
        
        fileHeader.addEventListener('dragleave', (e: DragEvent) => {
            const related = e.relatedTarget as Node | null;
            if (!related || (!fileHeader.contains(related) && !dropZone.contains(related))) {
                dropZone.style.display = 'none';
                dropZone.style.opacity = '0';
                console.debug(`Hiding drop zone for: ${fileContainer.dataset.fileName}`);
            }
        });
    }

    private isDraggedFileCompatible(e: DragEvent): boolean {
        if (!e.dataTransfer) return false;
        const types = Array.from(e.dataTransfer.types || []);
        console.debug('Drag types detected:', types);
        
        // Support for various drag sources
        if (types.includes('text/plain')) {
            console.debug('Text/plain detected - likely Obsidian file drag, wiki link, or tab');
            return true;
        }
        
        if (types.includes('Files')) {
            console.debug('Files type detected - external file drag');
            return true;
        }
        
        if (types.includes('text/uri-list')) {
            console.debug('URI list detected - possible tab or file reference');
            return true;
        }
        
        // Support for Obsidian-specific formats
        if (types.includes('application/x-obsidian-file') ||
            types.includes('application/x-obsidian-tab')) {
            console.debug('Obsidian specific format detected');
            return true;
        }
        
        console.debug('No compatible drag types found');
        return false;
    }

    private async handleFileDropAtPosition(e: DragEvent, targetFilePath?: string, position?: 'above' | 'below') {
        console.debug(`HandleFileDropAtPosition: ${targetFilePath}, ${position}`);
        try {
            const newFiles: TFile[] = [];
            if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/plain')) {
                const textData = e.dataTransfer.getData('text/plain');
                console.debug('Processing text data:', textData);
                if (!textData || !this.isValidFileData(textData)) { new Notice('Invalid file drag data'); return; }
                const filePaths = this.extractFilePathsFromDragData(textData);
                console.debug('Extracted file paths:', filePaths);
                for (const filePath of filePaths) {
                    const tfile = await this.findTFileFromPath(filePath);
                    if (tfile && tfile.extension === 'md') {
                        if (!this.allFiles.some(f => f.path === tfile.path)) {
                            newFiles.push(tfile);
                            console.debug(`Found TFile for: ${filePath} -> ${tfile.path}`);
                        }
                    }
                }
            }
            if (newFiles.length === 0) { new Notice('No valid files to add'); return; }
            let targetIndex = typeof targetFilePath === 'string' ? this.allFiles.findIndex(f => f.path === targetFilePath) : -1;
            if (targetIndex === -1) targetIndex = this.allFiles.length - 1;
            const insertIndex = position === 'above' ? targetIndex : targetIndex + 1;
            console.debug(`Inserting ${newFiles.length} files at index ${insertIndex}`);
            this.allFiles.splice(insertIndex, 0, ...newFiles);
            await this.refreshCurrentView();
            new Notice(`Added ${newFiles.length} file(s) ${position} target file`);
        } catch (error) {
            console.error('Error handling positioned file drop:', error);
            new Notice('Error adding files to continuous view');
        }
    }

    private extractFilePathsFromDragData(textData: string): string[] {
        const paths: string[] = [];
        let trimmed = (textData || '').trim();
        
        console.debug('Raw drag data received:', trimmed);
        
        if (!trimmed) return paths;
        
        // Handle Obsidian URI format: obsidian://open?vault=VaultName&file=Path%2FTo%2FFile
        if (trimmed.startsWith('obsidian://open?')) {
            try {
                const url = new URL(trimmed);
                const filePath = url.searchParams.get('file');
                
                if (filePath) {
                    let decodedPath = decodeURIComponent(filePath);
                    if (!decodedPath.endsWith('.md')) {
                        decodedPath += '.md';
                    }
                    paths.push(decodedPath);
                    console.debug('Extracted from Obsidian URI:', decodedPath);
                }
            } catch (error) {
                console.error('Failed to parse Obsidian URI:', error);
            }
        }
        // Handle wiki links: [[filename]] or [[filename|display text]]
        else if (/^\[\[.*\]\]$/.test(trimmed)) {
            let linkContent = trimmed.slice(2, -2);
            
            // Handle alias: [[filename|alias]] -> take only filename part
            let pipeIndex = linkContent.indexOf('|');
            if (pipeIndex >= 0) {
                linkContent = linkContent.slice(0, pipeIndex);
            }
            
            // Handle subpath links: [[filename#section]] -> take only filename part
            let hashIndex = linkContent.indexOf('#');
            if (hashIndex >= 0) {
                linkContent = linkContent.slice(0, hashIndex);
            }
            
            // Handle block references: [[filename^blockid]] -> take only filename part
            let caretIndex = linkContent.indexOf('^');
            if (caretIndex >= 0) {
                linkContent = linkContent.slice(0, caretIndex);
            }
            
            if (!linkContent.endsWith('.md')) {
                linkContent += '.md';
            }
            
            paths.push(linkContent);
            console.debug('Extracted from wiki link:', linkContent);
        }
        // Handle tab drag (file path with potential tab info)
        else if (trimmed.includes('/') && (trimmed.includes('.md') || !trimmed.includes('.'))) {
            // Clean up any tab-specific formatting
            let cleanPath = trimmed.split('\n')[0]; // Take first line if multi-line
            // Extract just the .md filename if present
            const mdMatch = cleanPath.match(/[^\/]+\.md/i);
            if (mdMatch && mdMatch[0]) {
                cleanPath = mdMatch[0];
            }
            
            if (!cleanPath.toLowerCase().endsWith('.md') && !cleanPath.includes('.')) {
                cleanPath += '.md';
            }
            
            paths.push(cleanPath);
            console.debug('Extracted from tab/path drag:', cleanPath);
        }
        // Handle direct file paths or URIs
        else if (trimmed.includes('/') || trimmed.toLowerCase().endsWith('.md')) {
            paths.push(trimmed);
            console.debug('Extracted direct path:', trimmed);
        }
        // Handle bare filenames
        else if (trimmed.length > 0) {
            let fileName = trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
            paths.push(fileName);
            console.debug('Extracted filename:', fileName);
        }
        
        console.debug('Final extracted paths:', paths);
        return paths.filter(path => path.length > 0);
    }

    private async findTFileFromPath(filePath: string): Promise<TFile | null> {
        console.debug('Finding TFile for path:', filePath);
        if (!filePath) return null;
        
        // Try direct path lookup first
        const direct = this.app.vault.getAbstractFileByPath(filePath);
        if (direct instanceof TFile) {
            console.debug('Found by direct path:', direct.path);
            return direct;
        }
        
        // Extract just the filename for fallback searches
        let fileName = filePath.split('/').pop() || filePath;
        
        // Ensure .md extension
        if (!fileName.endsWith('.md')) {
            fileName += '.md';
        }
        
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        // Search by exact filename match
        let fileByName = markdownFiles.find(f => f.name === fileName) || null;
        if (fileByName) {
            console.debug('Found by filename:', fileByName.path);
            return fileByName;
        }
        
        // Search by basename (without extension)
        const baseName = fileName.replace('.md', '');
        let fileByBasename = markdownFiles.find(f => f.basename === baseName) || null;
        if (fileByBasename) {
            console.debug('Found by basename:', fileByBasename.path);
            return fileByBasename;
        }
        
        // Search by partial path matching (for files in subfolders)
        let fileByPartialPath = markdownFiles.find(f => {
            try {
                return (
                    f.path.endsWith(filePath) ||
                    f.path.endsWith(filePath.replace('.md', '')) ||
                    filePath.includes(f.basename) ||
                    f.basename.toLowerCase() === baseName.toLowerCase()
                );
            } catch (error) {
                return false;
            }
        }) || null;
        
        if (fileByPartialPath) {
            console.debug('Found by partial path matching:', fileByPartialPath.path);
            return fileByPartialPath;
        }
        
        console.debug(`No TFile found for path: ${filePath}`);
        return null;
    }

    private isValidFileData(textData: string): boolean {
        if (!textData || typeof textData !== 'string') {
            return false;
        }
        
        const trimmed = textData.trim();
        
        // Obsidian URI format
        if (trimmed.startsWith('obsidian://open?')) {
            console.debug('Valid Obsidian URI detected');
            return true;
        }
        
        // Wiki link format
        if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
            console.debug('Valid wiki link detected');
            return true;
        }
        
        // Tab drag (often contains file path)
        if (trimmed.includes('/') || trimmed.includes('.md')) {
            console.debug('Valid file path detected');
            return true;
        }
        
        // Bare filename or simple text that could be a file
        if (/^[a-zA-Z0-9\s\-_.#^|]+$/.test(trimmed)) {
            console.debug('Valid filename characters detected');
            return true;
        }
        
        console.debug('Invalid file data:', trimmed);
        return false;
    }

    private async refreshCurrentView() {
        const containerEl = this.containerEl.children[1] as HTMLElement;
        const scrollTop = containerEl?.scrollTop || 0;
        this.contentContainer.empty();
        const startIndex = this.currentIndex;
        const endIndex = Math.min(startIndex + this.plugin.settings.maxFileCount, this.allFiles.length);
        this.loadedFiles = this.allFiles.slice(startIndex, endIndex);
        await this.appendFilesToDOM(this.loadedFiles);
        this.updateScrollElements();
        setTimeout(() => { const cont = this.containerEl.children[1] as HTMLElement; if (cont) cont.scrollTop = scrollTop; }, 50);
    }

    public async exportToSingleFile() {
        if (!this.currentFolder || this.allFiles.length === 0) { new Notice('No folder or files to export.'); return; }
        let combinedContent = `# Combined notes from ${this.currentFolder.name}\n\n`;
        for (const file of this.allFiles) { const content = await this.app.vault.read(file); combinedContent += `\n\n---\n\n## ${file.basename}\n\n${content}`; }
        const newFileName = `Combined - ${this.currentFolder.name}.md`;
        const newFilePath = this.currentFolder.isRoot() ? newFileName : `${this.currentFolder.path}/${newFileName}`;
        try {
            if (this.app.vault.getAbstractFileByPath(newFilePath)) { new Notice(`File "${newFileName}" already exists. Please rename or remove it first.`); return; }
            const created = await this.app.vault.create(newFilePath, combinedContent);
            new Notice(`Successfully exported to "${created.path}".`);
            this.app.workspace.getLeaf('tab').openFile(created);
        } catch (error) {
            console.error('Error exporting to single file:', error);
            new Notice('Failed to export file.');
        }
    }

}
