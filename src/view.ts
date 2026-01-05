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

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('enhanced-continuous-container');

        this.addAction('document', 'Export as single document', () => this.exportToSingleFile());
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
            
            entries.forEach(entry => {
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
                `[data-path="${fileName}"]`,
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
                    if (navTitle.textContent?.trim() === baseName) {
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
        const container = document.createElement('div')
        container.classList.add('file-container')
        container.dataset.fileName = file.path

        // Header with title + close button
        const header = container.createDiv('file-header')

        // Flex wrapper for title (allows close button to float right)
        const titleGroup = header.createDiv('file-title-group')
        const title = titleGroup.createEl('h2', {
            text: file.basename,
            cls: 'file-title'
        })

        title.style.cursor = 'pointer'
        title.addEventListener('click', () => {
            this.app.workspace.getLeaf('tab').openFile(file)
        })

        // Close button (×)
        const closeBtn = header.createEl('button', {
            cls: 'file-close-btn',
            attr: { 'aria-label': `Remove ${file.basename} from view` }
        })
        closeBtn.innerHTML = '×'
        closeBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            e.preventDefault()
            console.log(`🗑️  FolderContinuousView: Removing ${file.basename}`)

            // Remove from loadedFiles array
            this.loadedFiles = this.loadedFiles.filter(f => f.path !== file.path)

            // Remove from DOM
            container.remove()

            // Unobserve from observer if available
            if (this.activeFileObserver) {
                this.activeFileObserver.unobserve(container)
            }

            // Update display count in title
            this.updateDisplayText()
        })

        // File content area
        const content = container.createDiv('file-content')
        content.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.switchToEditorView(file, container);
        });
        await this.renderFileContent(file, content)

        // DON'T observe here - will be done after DOM insertion
        console.debug(`Created element for file: ${file.path}`);
        return container
    }

    async switchToEditorView(file: TFile, fileContainer: Element) {
        if (this.activeEditor) {
            await this.cleanupActiveEditor();
        }

        const fileContent = fileContainer.querySelector('.file-content');
        if (!fileContent || !this.isHTMLElement(fileContent)) return;

        try {
            // Create a completely hidden leaf that won't show in UI
            const hiddenLeaf = this.app.workspace.createLeafInParent(
                this.app.workspace.rootSplit, 
                -1
            );

            // Hide BEFORE opening file to prevent flash
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
                console.error('Failed to get MarkdownView or editor');
                hiddenLeaf.detach();
                return this.createFallbackEditor(file, fileContent, fileContainer);
            }

            // Extract editor elements silently
            const contentEl = view.contentEl;
            const editorElement = contentEl?.querySelector('.cm-editor, .markdown-source-view');

            if (!editorElement || !this.isHTMLElement(editorElement)) {
                console.error('Could not find valid editor element');
                hiddenLeaf.detach();
                return this.createFallbackEditor(file, fileContent, fileContainer);
            }

            // Create clean editor container first
            fileContent.empty();
            const editorWrapper = fileContent.createDiv('native-editor-wrapper');
            
            // Create editor header with exit button
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
            exitButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
                    style="margin-right: 4px;">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
                Exit
            `;
            
            exitButton.addEventListener('click', async () => {
                const content = view.editor.getValue();
                await this.app.vault.modify(file, content);
                await this.cleanupActiveEditor();
                await this.renderFileContent(file, fileContent);
            });
            
            // Set up proper scrollable editor wrapper
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
                max-height: 358px; /* 400px - header height */
                overflow: auto !important;
            `);

            // Ensure editor element is properly sized
            editorElement.setAttribute('style', `
                width: 100%;
                min-height: 200px;
                max-height: none;
                opacity: 0;
                transition: opacity 0.2s ease-in-out;
            `);

            // Move editor element without affecting visibility
            editorElement.detach();
            editorContainer.appendChild(editorElement);

            // Create focus trap overlay with pointer-events: none
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

            // Store references for cleanup
            this.activeEditor = {
                file: file,
                container: fileContainer,
                leaf: hiddenLeaf,
                markdownView: view,
                editorElement: editorElement,
                originalParent: contentEl,
                overlay: overlay
            };

            // Setup all exit handlers
            this.setupEditorExitHandlers(view, fileContainer, file, overlay);

            // Fade in smoothly
            requestAnimationFrame(() => {
                editorElement.style.transition = 'opacity 0.2s ease-in-out';
                editorElement.style.opacity = '1';
            });

            // Focus the editor after transition
            setTimeout(() => {
                if (view.editor && view.editor.focus) {
                    view.editor.focus();
                }
            }, 250);

            // Add visual indication of edit mode
            fileContainer.addClass('editing-active');

            // Add hover effect for exit button
            exitButton.addEventListener('mouseenter', () => {
                exitButton.style.backgroundColor = 'var(--interactive-hover)';
            });
            exitButton.addEventListener('mouseleave', () => {
                exitButton.style.backgroundColor = 'var(--background-secondary)';
            });

        } catch (error) {
            console.error('Silent editor creation failed:', error);
            if (fileContent) {
                this.createFallbackEditor(file, fileContent, fileContainer);
            }
        }
    }

    private createFallbackEditor(file: TFile, fileContent: Element, fileContainer: Element): void {
        console.warn('Creating fallback textarea editor');
        if (!this.isHTMLElement(fileContent)) {
            console.error('fileContent is not an HTMLElement');
            return;
        }

        fileContent.empty();
        const container = fileContent.createDiv('fallback-editor-container');
        const textarea = container.createEl('textarea', {
            cls: 'fallback-inline-editor',
            attr: { 
                placeholder: 'Loading content...',
                style: 'width: 100%; min-height: 200px; resize: vertical;'
            }
        });

        // Create overlay for click-outside detection
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

        // Load file content
        this.app.vault.read(file).then(content => {
            textarea.value = content;
            textarea.focus();
        }).catch(error => {
            console.error('Error loading file content:', error);
            textarea.value = 'Error loading file content';
        });

        // Setup save functionality
        const saveAndExit = async () => {
            try {
                await this.app.vault.modify(file, textarea.value);
                await this.cleanupActiveEditor();
                
                if (this.isHTMLElement(fileContent)) {
                    await this.renderFileContent(file, fileContent);
                }
            } catch (error) {
                console.error('Error saving fallback editor:', error);
                new Notice('Failed to save file');
            }
        };

        // Exit handlers
        const keyboardHandler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                saveAndExit();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                saveAndExit();
            }
        };

        // Click outside handler
        const clickOutsideHandler = (event: MouseEvent) => {
            if (event.target === overlay) {
                saveAndExit();
            }
        };

        // Add event listeners
        textarea.addEventListener('keydown', keyboardHandler);
        overlay.addEventListener('click', clickOutsideHandler);
        document.addEventListener('keydown', keyboardHandler);

        // Store reference for cleanup
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

        // Add visual indication of edit mode
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
                console.error('Error saving editor:', error);
                new Notice('Failed to save file');
            }
        };

        // Improved selective event handling with better scroll support
        const selectiveHandler = (event: Event) => {
            const target = event.target as Element;
            const editorElement = this.activeEditor?.editorElement;
            
            if (!editorElement) return;

            // Always allow events within editor area
            if (editorElement.contains(target)) {
                return; // Let event proceed normally
            }

            // Allow all scroll events
            if (event.type === 'wheel' || event.type === 'scroll') {
                return; // Let scroll events proceed
            }

            // Handle container interactions
            const isInContainer = 
                target.closest('.file-content-container') || 
                target.closest('.enhanced-continuous-container') ||
                this.contentContainer?.contains(target);

            if (isInContainer) {
                // Allow scrolling in containers
                if (event.type === 'wheel' || event.type === 'scroll') {
                    return;
                }
                
                // For clicks in container, refocus editor but don't block
                if (event.type === 'mousedown' || event.type === 'click') {
                    requestAnimationFrame(() => {
                        if (editorElement instanceof HTMLElement && editorElement.focus) {
                            editorElement.focus();
                        }
                    });
                    return;
                }
            }

            // Handle keyboard events
            if (event instanceof KeyboardEvent) {
                // Exit key combinations
                if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
                    event.preventDefault();
                    event.stopPropagation();
                    saveAndExit();
                    return;
                }
                
                // Block other keyboard events outside editor
                if (!editorElement.contains(target)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (editorElement instanceof HTMLElement && editorElement.focus) {
                        editorElement.focus();
                    }
                    return;
                }
            }

            // Click outside editor area
            if (event.type === 'mousedown' && event.target === overlay) {
                event.preventDefault();
                event.stopPropagation();
                saveAndExit();
                return;
            }

            // For any other click outside, ensure focus stays in editor
            if (event.type === 'mousedown' && !editorElement.contains(target)) {
                requestAnimationFrame(() => {
                    if (editorElement instanceof HTMLElement && editorElement.focus) {
                        editorElement.focus();
                    }
                });
            }
        };

        // Set overlay to not block pointer events by default
        overlay.style.pointerEvents = 'none';

        // Register only necessary event handlers
        const eventTypes = ['keydown', 'mousedown', 'click'];
        eventTypes.forEach(eventType => {
            document.addEventListener(eventType, selectiveHandler, {
                capture: true,
                passive: false
            });
        });

        // Store cleanup functions
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
            // Clean up all registered handlers first
            if (this.activeEditor.handlers) {
                this.activeEditor.handlers.forEach(handler => {
                    try { handler(); } catch (e) { console.error('Handler cleanup error:', e); }
                });
            }

            // Clean up all specific cleanup handlers
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

            // CRITICAL: Restore editor element BEFORE detaching leaf
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

            // Proper leaf cleanup to prevent workspace corruption
            if (this.activeEditor.leaf) {
                try {
                    const containerEl = (this.activeEditor.leaf as any).containerEl;
                    if (containerEl) {
                        // Reset container styles
                        containerEl.style.display = '';
                        containerEl.style.position = '';
                        containerEl.style.left = '';
                        containerEl.style.top = '';
                        containerEl.style.opacity = '';
                        containerEl.style.visibility = '';
                    }

                    // Wait a frame before detaching to ensure styles are applied
                    await new Promise(resolve => requestAnimationFrame(resolve));

                    // Remove from workspace references before detaching
                    const workspace = this.app.workspace;
                    if (workspace.activeLeaf === this.activeEditor.leaf) {
                        workspace.activeLeaf = null;
                    }

                    // Force detach the leaf completely
                    this.activeEditor.leaf.detach();

                } catch (e) {
                    console.error('Leaf cleanup error:', e);
                }
            }

            // Clean up overlay if it exists
            if (this.activeEditor.overlay && this.activeEditor.overlay.parentNode) {
                this.activeEditor.overlay.parentNode.removeChild(this.activeEditor.overlay);
            }

            // Remove editing state from container
            if (this.activeEditor.container) {
                this.activeEditor.container.removeClass('editing-active');
            }

        } catch (error) {
            console.error('Complete cleanup error:', error);
            // Last resort: force detach leaf
            if (this.activeEditor.leaf) {
                try { 
                    this.activeEditor.leaf.detach(); 
                } catch (e) { 
                    console.error('Force detach failed:', e); 
                }
            }
        }

        this.activeEditor = null;
    }

    private async appendFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        
        // Create all elements first (without observing)
        for (const file of files) {
            const element = await this.createFileElement(file);
            fragment.appendChild(element);
            console.debug(`Created element for file: ${file.path}`);
        }
        
        // Add entire fragment to DOM
        this.contentContainer.appendChild(fragment);
        
        // CRITICAL: Observe elements AFTER they're in DOM with delay
        setTimeout(() => {
            files.forEach(file => {
                const element = this.contentContainer.querySelector(`[data-file-name="${file.path}"]`);
                if (element) {
                    this.activeFileObserver.observe(element);
                    console.debug(`Added observer for file: ${file.path}`);
                } else {
                    console.warn(`Element not found for observation: ${file.path}`);
                }
            });
        }, 100); // Small delay ensures DOM is ready
    }

    private async prependFilesToDOM(files: TFile[]) {
        const fragment = document.createDocumentFragment();
        
        // Create elements in reverse order for prepending
        for (const file of files.reverse()) {
            const element = await this.createFileElement(file);
            fragment.prepend(element);
            console.debug(`Created element for prepended file: ${file.path}`);
        }
        
        this.contentContainer.prepend(fragment);
        
        // CRITICAL: Re-establish active file observation  
        files.forEach(file => {
            const element = this.contentContainer.querySelector(`[data-file-name="${file.path}"]`);
            if (element) {
                this.activeFileObserver.observe(element);
                console.debug(`Added observer for prepended file: ${file.path}`);
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
                // Properly unobserve before removing
                this.activeFileObserver.unobserve(element);
                element.remove();
                console.debug(`Removed and unobserved file: ${file.path}`);
            }
        });
    }

    private createScrollElements(container: HTMLElement) {
        // Create indicators (initially hidden)
        this.topIndicator = container.createDiv({
            cls: "scroll-indicator top-indicator",
            text: "⇈",
            attr: { style: "display: none;" }
        });
        
        // Create sentinels (minimal height, invisible)
        this.topSentinel = container.createDiv({
            cls: "scroll-sentinel top-sentinel",
            attr: { style: "height: 1px; width: 100%; opacity: 0;" }
        });
        
        // Main content container
        this.contentContainer = container.createDiv("file-content-container");
        
        // Bottom sentinel
        this.bottomSentinel = container.createDiv({
            cls: "scroll-sentinel bottom-sentinel", 
            attr: { style: "height: 1px; width: 100%; opacity: 0;" }
        });
        
        // Bottom indicator
        this.bottomIndicator = container.createDiv({
            cls: "scroll-indicator bottom-indicator",
            text: "⇊",
            attr: { style: "display: none;" }
        });
        
        // FIXED: Force re-initialization of observers
        setTimeout(() => {
            console.debug("Setting up observers after DOM ready");
            
            // Always recreate observers to ensure they're active
            this.setupIntersectionObserver();
            this.setupActiveFileObserver();
            
            // Verify observers exist before using
            if (this.intersectionObserver && this.bottomSentinel) {
                this.intersectionObserver.observe(this.bottomSentinel);
                this.bottomIndicator.style.display = "block";
                console.debug("Bottom sentinel initially observed");
            } else {
                console.error("Observer or sentinel missing after setup");
            }
            
            console.debug("Initial observers setup complete");
        }, 150);
    }

    private updateScrollElements() {
        console.debug('UpdateScrollElements called', {
            currentIndex: this.currentIndex,
            loadedFilesCount: this.loadedFiles.length,
            totalFiles: this.allFiles.length
        });
        
        // Ensure observer exists before disconnect
        if (!this.intersectionObserver) {
            console.warn("Intersection observer missing, recreating...");
            this.setupIntersectionObserver();
        }
        
        this.intersectionObserver.disconnect();
        
        // Top sentinel logic
        if (this.currentIndex > 0) {
            this.intersectionObserver.observe(this.topSentinel);
            this.topIndicator.style.display = "block";
            console.debug('Top sentinel re-observed');
        } else {
            this.topIndicator.style.display = "none";
        }
        
        // Bottom sentinel logic - CRITICAL FIX
        const totalAccessible = this.currentIndex + this.loadedFiles.length;
        const hasMoreFiles = totalAccessible < this.allFiles.length;
        
        if (hasMoreFiles) {
            this.intersectionObserver.observe(this.bottomSentinel);
            this.bottomIndicator.style.display = "block";
            console.debug(`Bottom sentinel re-observed. Accessible: ${totalAccessible}, Total: ${this.allFiles.length}`);
        } else {
            this.bottomIndicator.style.display = "none";
            console.debug(`At end. Accessible: ${totalAccessible}, Total: ${this.allFiles.length}`);
        }
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
        try {
            // Clean up active editor first
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

            // Clean up loaded files and observers
            if (this.loadedFiles.length > 0) {
                this.loadedFiles.forEach(file => {
                    const element = this.contentContainer?.querySelector(`[data-file-name="${file.path}"]`);
                    if (element) {
                        // Remove all event listeners by cloning
                        const headerEl = element.querySelector('.file-header');
                        if (headerEl) {
                            const clone = headerEl.cloneNode(true);
                            headerEl.parentNode?.replaceChild(clone, headerEl);
                        }

                        const contentEl = element.querySelector('.file-content');
                        if (contentEl) {
                            const clone = contentEl.cloneNode(true);
                            contentEl.parentNode?.replaceChild(clone, contentEl);
                        }

                        // Remove from observer
                        if (this.activeFileObserver) {
                            this.activeFileObserver.unobserve(element);
                        }
                        element.remove();
                    }
                });
            }

            // Reset state
            this.loadedFiles = [];
            this.allFiles = [];
            this.currentFolder = null;
            this.currentIndex = 0;

            // Clean up DOM elements
            if (this.contentContainer) {
                // Remove all event listeners by cloning
                const clone = this.contentContainer.cloneNode(false) as HTMLElement;
                if (this.contentContainer.parentNode) {
                    this.contentContainer.parentNode.replaceChild(clone, this.contentContainer);
                }
                this.contentContainer = clone;
                this.contentContainer.empty();
            }

            // Clean up scroll elements
            const scrollElements = {
                topIndicator: createDiv(),
                topSentinel: createDiv(),
                bottomSentinel: createDiv(),
                bottomIndicator: createDiv()
            };

            // Clean up and replace scroll elements
            ['topIndicator', 'topSentinel', 'bottomSentinel', 'bottomIndicator'].forEach(elementName => {
                const element = this[elementName as keyof typeof scrollElements] as HTMLElement;
                if (element && element.parentNode) {
                    const clone = element.cloneNode(false) as HTMLElement;
                    element.parentNode.replaceChild(clone, element);
                }
                this[elementName as keyof typeof scrollElements] = scrollElements[elementName as keyof typeof scrollElements];
            });

            // Clean up debounced functions
            if (this.loadNextFilesDebounced) {
                // @ts-ignore - Clear timeout reference
                clearTimeout(this.loadNextFilesDebounced.timeout);
                this.loadNextFilesDebounced = this.debounce(this.loadNextFiles.bind(this), 200);
            }
            if (this.loadPreviousFilesDebounced) {
                // @ts-ignore - Clear timeout reference
                clearTimeout(this.loadPreviousFilesDebounced.timeout);
                this.loadPreviousFilesDebounced = this.debounce(this.loadPreviousFiles.bind(this), 200);
            }

            // Re-initialize observers if needed
            if (!this.intersectionObserver) {
                this.setupIntersectionObserver();
            }
            if (!this.activeFileObserver) {
                this.setupActiveFileObserver();
            }

        } catch (error) {
            console.error('Resource cleanup error:', error);
            // Attempt to reset state even if cleanup fails
            this.loadedFiles = [];
            this.allFiles = [];
            this.currentFolder = null;
            this.currentIndex = 0;
            if (this.contentContainer) {
                this.contentContainer.empty();
            }
        }

        // Force hint to garbage collector
        if (typeof global !== 'undefined' && global.gc) {
            try {
                global.gc();
            } catch (e) {
                console.debug('Manual GC not available');
            }
        }
    }

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
