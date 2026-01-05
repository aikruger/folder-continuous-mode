import {
    ItemView,
    WorkspaceLeaf,
    TFile,
    Notice,
    MarkdownRenderer
} from 'obsidian'
import { FileRenderer } from '../services/FileRenderer'
import { ScrollManager } from '../services/ScrollManager'

export const CANVAS_NODES_VIEW_TYPE = 'canvas-nodes-continuous-view'

/**
 * CanvasNodesContinuousView displays all text and file nodes from an open canvas
 * in a continuous scrollable format, allowing users to view and edit canvas content
 * without jumping between different parts of the canvas.
 *
 * Supported node types:
 * - File nodes: References to other files; shows full file content
 * - Text nodes: Markdown text boxes; shows formatted markdown
 */
export class CanvasNodesContinuousView extends ItemView {
    private fileRenderer: FileRenderer | null = null
    private scrollManager: ScrollManager | null = null
    private contentContainer: HTMLElement | null = null

    private currentCanvas: TFile | null = null
    private canvasData: any = null
    private nodeElements: Map<string, HTMLElement> = new Map()
    private activeEditorNodeId: string | null = null

    constructor(leaf: WorkspaceLeaf) {
        super(leaf)
    }

    getViewType(): string {
        return CANVAS_NODES_VIEW_TYPE
    }

    getDisplayText(): string {
        const canvasName = this.currentCanvas?.basename ?? 'Canvas Nodes'
        return `Continuous: ${canvasName}`
    }

    async onOpen(): Promise<void> {
        console.log('🟢 CanvasNodesContinuousView.onOpen()')

        const root = this.containerEl.children[1] as HTMLElement
        root.empty()
        root.addClass('canvas-nodes-continuous-view')

        // Create content container for scrolling
        this.contentContainer = root.createDiv('content-area')
        this.contentContainer.addClass('scroll-container')

        // Initialize services
        this.fileRenderer = new FileRenderer(this.app)
        this.scrollManager = new ScrollManager(this.contentContainer, {
            maxFiles: 10,
            loadCount: 3,
            rootMargin: '100px 0px',
            threshold: 0.1
        })

        // Load initial state and setup listeners
        await this.loadInitialState()
        this.setupWorkspaceListeners()
        this.setupScrollListeners()
        this.setupDoubleClickEditing()

        console.log('✓ CanvasNodesContinuousView initialized')
    }

    private async loadInitialState(): Promise<void> {
        /**
         * On first open, try to detect active canvas file.
         * If found, load and render its nodes.
         */
        const activeLeaf = this.app.workspace.activeLeaf
        if (!activeLeaf) {
            this.contentContainer!.setText('No active canvas found')
            return
        }

        // Check if active view is a canvas
        if (activeLeaf.view.getViewType() !== 'canvas') {
            this.contentContainer!.setText(
                'Please open a canvas file first, then use this view to see nodes in continuous mode.'
            )
            new Notice('No canvas file active. Open a canvas and try again.')
            return
        }

        // Get the canvas file
        let canvasFile: TFile | null = null

        // Try multiple ways to get the file reference
        if ((activeLeaf.view as any).file) {
            canvasFile = (activeLeaf.view as any).file
        } else if ((activeLeaf.view as any).canvas?.path) {
            const canvasPath = (activeLeaf.view as any).canvas.path
            canvasFile = this.app.vault.getAbstractFileByPath(canvasPath) as TFile
        }

        if (!canvasFile || canvasFile.extension !== 'canvas') {
            this.contentContainer!.setText('Unable to access canvas file information.')
            return
        }

        await this.renderCanvas(canvasFile)
    }

    private async renderCanvas(canvasFile: TFile): Promise<void> {
        /**
         * Parse canvas JSON and render all nodes in continuous view.
         * Nodes are sorted by Y position for logical reading order.
         */
        try {
            this.currentCanvas = canvasFile

            // Read and parse canvas JSON
            const canvasText = await this.app.vault.read(canvasFile)
            this.canvasData = JSON.parse(canvasText)

            console.log(`📋 CanvasNodesContinuousView: Loaded canvas ${canvasFile.basename}`)

            const nodes = this.canvasData.nodes || []
            if (nodes.length === 0) {
                this.contentContainer!.setText('This canvas has no nodes.')
                return
            }

            // Clear previous content
            this.contentContainer!.empty()
            this.nodeElements.clear()

            // SORT NODES: Left-to-right, top-to-bottom
            const sortedNodes = nodes.sort((a: any, b: any) => {
                // Primary sort: by X position (left-to-right)
                const x1 = a.x || 0;
                const x2 = b.x || 0;
                if (Math.abs(x1 - x2) > 50) return x1 - x2;  // Different columns if X differs by >50

                // Secondary sort: by Y position (top-to-bottom) if in same column
                const y1 = a.y || 0;
                const y2 = b.y || 0;
                return y1 - y2;
            });

            console.log(`📋 CanvasNodesContinuousView: Sorted ${sortedNodes.length} nodes by position`);

            // Filter only valid nodes
            const validNodes = sortedNodes.filter((n: any) => (n.type === 'file' && n.file) || (n.type === 'text' && n.text));

            for (const node of validNodes) {
                const element = await this.renderCanvasNode(node, canvasFile)
                if (element) {
                    this.contentContainer!.appendChild(element)
                    this.nodeElements.set(node.id, element)
                }
            }

            // Setup scroll observer
            this.scrollManager!.setData(validNodes)

            new Notice(`Loaded ${validNodes.length} nodes (sorted by position)`)

        } catch (error) {
            console.error('Error rendering canvas:', error)
            this.contentContainer!.setText(`Error loading canvas: ${(error as Error).message}`)
            new Notice('Failed to load canvas')
        }
    }

    private async renderCanvasNode(node: any, canvasFile: TFile): Promise<HTMLElement | null> {
        let nodeDiv = document.createElement("div");
        nodeDiv.classList.add("canvas-node-container");
        nodeDiv.dataset.nodeId = node.id;

        let headerDiv = nodeDiv.createDiv("file-header");
        let titleGroupDiv = headerDiv.createDiv("file-title-group");

        // ==========================================
        // FILE NODE HANDLING
        // ==========================================
        if (node.type === "file") {
            // Get the referenced file
            let referencedFile = this.app.vault.getAbstractFileByPath(node.file) as TFile;
            if (!referencedFile) {
                console.warn(`Canvas file node references missing file: ${node.file}`);
                return null;
            }

            // Create title
            let titleEl = titleGroupDiv.createEl("h3", {
                text: `📄 ${referencedFile.basename}`,
                cls: "file-title"
            });
            titleEl.style.cursor = "pointer";
            titleEl.addEventListener("click", () => {
                this.app.workspace.getLeaf("tab").openFile(referencedFile);
            });

            // Create close button
            let closeBtn = headerDiv.createEl("button", {
                cls: "file-close-btn",
                attr: {
                    "aria-label": "Remove node from view"
                }
            });
            closeBtn.innerHTML = "×";
            closeBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                console.log(`🗑️ Removing canvas node: ${node.id}`);
                nodeDiv.remove();
                this.nodeElements.delete(node.id);
            });

            // Render file content
            let contentDiv = nodeDiv.createDiv("file-content");
            await this.renderFileContent(referencedFile, contentDiv);

            // Add double-click editing support
            contentDiv.addEventListener("dblclick", async (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (this.activeEditorNodeId === node.id) return;
                this.activeEditorNodeId = node.id;
                nodeDiv.addClass("editing-active");

                try {
                    // Read file content
                    let fileContent = await this.app.vault.read(referencedFile);

                    // Create editor container
                    let editorContainer = contentDiv.createDiv("file-node-editor");
                    let textarea = editorContainer.createEl("textarea", {
                        cls: "fallback-inline-editor canvas-file-editor",
                        value: fileContent
                    });

                    textarea.focus();
                    textarea.select();

                    // Create overlay
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

                    // Save handler
                    let saveFile = async () => {
                        try {
                            let newContent = textarea.value;
                            await this.app.vault.modify(referencedFile, newContent);
                            console.log(`✓ Saved canvas file node: ${referencedFile.basename}`);

                            editorContainer.remove();
                            overlay.remove();
                            nodeDiv.removeClass("editing-active");
                            this.activeEditorNodeId = null;

                            contentDiv.empty();
                            await this.renderFileContent(referencedFile, contentDiv);
                        } catch (error) {
                            console.error("Error saving file:", error);
                            new Notice(`Failed to save ${referencedFile.basename}: ${(error as Error).message}`);
                        }
                    };

                    // Cancel handler
                    let cancelEdit = () => {
                        editorContainer.remove();
                        overlay.remove();
                        nodeDiv.removeClass("editing-active");
                        this.activeEditorNodeId = null;
                    };

                    // Key handler
                    let onKeyDown = async (event: KeyboardEvent) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                            event.preventDefault();
                            await saveFile();
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                            return;
                        }
                    };

                    // Overlay click handler
                    let onOverlayClick = async (event: MouseEvent) => {
                        if (event.target === overlay) {
                            event.preventDefault();
                            await saveFile();
                        }
                    };

                    textarea.addEventListener("keydown", onKeyDown);
                    overlay.addEventListener("click", onOverlayClick);

                } catch (error) {
                    console.error("Error activating editor:", error);
                    new Notice(`Failed to open editor: ${(error as Error).message}`);
                    nodeDiv.removeClass("editing-active");
                    this.activeEditorNodeId = null;
                }
            });

            return nodeDiv;

        // ==========================================
        // TEXT NODE HANDLING
        // ==========================================
        } else if (node.type === "text") {
            // Create title from text preview
            let textPreview = node.text.substring(0, 60).replace(/\n/g, " ");
            let titleEl = titleGroupDiv.createEl("h3", {
                text: `💬 ${textPreview}...`,
                cls: "file-title"
            });

            // Create close button
            let closeBtn = headerDiv.createEl("button", {
                cls: "file-close-btn",
                attr: {
                    "aria-label": "Remove node from view"
                }
            });
            closeBtn.innerHTML = "×";
            closeBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                console.log(`🗑️ Removing text node: ${node.id}`);
                nodeDiv.remove();
                this.nodeElements.delete(node.id);
            });

            // Create content div for rendered markdown
            let contentDiv = nodeDiv.createDiv("file-content");
            let textNodeDiv = contentDiv.createDiv("canvas-text-node");

            try {
                // Render text as markdown
                await MarkdownRenderer.renderMarkdown(
                    node.text,
                    textNodeDiv,
                    canvasFile.path,
                    // @ts-ignore
                    null
                );
            } catch (error) {
                console.error("Error rendering canvas text node:", error);
                textNodeDiv.setText(node.text);
            }

            // Add double-click editing support
            textNodeDiv.addEventListener("dblclick", async (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (this.activeEditorNodeId === node.id) return;
                this.activeEditorNodeId = node.id;
                nodeDiv.addClass("editing-active");

                try {
                    // Create editor
                    let editorContainer = contentDiv.createDiv("text-node-editor");
                    let textarea = editorContainer.createEl("textarea", {
                        cls: "fallback-inline-editor canvas-text-editor",
                        value: node.text
                    });

                    textarea.focus();
                    textarea.select();

                    // Create overlay
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

                    // Save handler
                    let saveText = async () => {
                        try {
                            node.text = textarea.value;

                            // Update canvas data with new text
                            this.canvasData.nodes = this.canvasData.nodes.map((n: any) =>
                                n.id === node.id ? node : n
                            );

                            // Write updated canvas to vault
                            await this.app.vault.modify(
                                this.currentCanvas!,
                                JSON.stringify(this.canvasData, null, 2)
                            );

                            console.log(`✓ Saved text node: ${node.id}`);

                            editorContainer.remove();
                            overlay.remove();
                            nodeDiv.removeClass("editing-active");
                            this.activeEditorNodeId = null;

                            // Re-render the text node
                            textNodeDiv.empty();
                            await MarkdownRenderer.renderMarkdown(
                                node.text,
                                textNodeDiv,
                                canvasFile.path,
                                // @ts-ignore
                                null
                            );
                        } catch (error) {
                            console.error("Error saving text node:", error);
                            new Notice("Failed to save text node");
                        }
                    };

                    // Cancel handler
                    let cancelEdit = () => {
                        editorContainer.remove();
                        overlay.remove();
                        nodeDiv.removeClass("editing-active");
                        this.activeEditorNodeId = null;
                    };

                    // Key handler
                    let onKeyDown = async (event: KeyboardEvent) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                            event.preventDefault();
                            await saveText();
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                            return;
                        }
                    };

                    // Overlay handler
                    let onOverlayClick = async (event: MouseEvent) => {
                        if (event.target === overlay) {
                            event.preventDefault();
                            await saveText();
                        }
                    };

                    textarea.addEventListener("keydown", onKeyDown);
                    overlay.addEventListener("click", onOverlayClick);

                } catch (error) {
                    console.error("Error activating editor:", error);
                    new Notice(`Failed to open editor: ${(error as Error).message}`);
                    nodeDiv.removeClass("editing-active");
                    this.activeEditorNodeId = null;
                }
            });

            return nodeDiv;
        }

        return null;
    }

    private async renderFileContent(file: TFile, container: HTMLElement): Promise<void> {
        /**
         * Render markdown file content in the provided container.
         * Used for both file node references and general file rendering.
         */
        try {
            const markdown = await this.app.vault.read(file)
            await MarkdownRenderer.renderMarkdown(
                markdown,
                container,
                file.path,
                // @ts-ignore
                null
            )
        } catch (error) {
            console.error(`Failed to render ${file.path}:`, error)
            container.setText(`Error rendering file: ${(error as Error).message}`)
        }
    }

    private setupWorkspaceListeners(): void {
        /**
         * Listen for workspace changes:
         * - When user switches to a different canvas, reload it
         * - When canvas file is modified, refresh the view
         */
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', async () => {
                const activeLeaf = this.app.workspace.activeLeaf
                if (activeLeaf?.view.getViewType() === 'canvas') {
                    const canvasFile = (activeLeaf.view as any).file
                    if (canvasFile && this.currentCanvas?.path !== canvasFile.path) {
                        console.log(`🔄 Canvas switched, reloading: ${canvasFile.basename}`)
                        await this.renderCanvas(canvasFile)
                    }
                }
            })
        )

        // Update if canvas file is modified
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && file === this.currentCanvas && file.extension === 'canvas') {
                    console.log('🔄 Canvas modified, refreshing view')
                    await this.renderCanvas(file)
                }
            })
        )
    }

    private setupScrollListeners(): void {
        /**
         * Setup infinite scroll support (ready for future enhancement).
         * Currently loads all nodes on open.
         */
        this.scrollManager!.onLoadMore(async (direction) => {
            console.log('📜 Canvas scroll load triggered:', direction)
            // Could implement lazy loading for very large canvases
        })
    }

    private setupDoubleClickEditing(): void {
        /**
         * Enable double-click editing for text nodes.
         * File nodes open in main editor; text nodes edit inline.
         */
        this.contentContainer!.addEventListener('dblclick', async (e: Event) => {
            const target = e.target as HTMLElement
            const container = target.closest('.canvas-node-container') as HTMLElement | null
            if (!container) return

            const nodeId = container.dataset.nodeId
            if (!nodeId) return

            // Find the node in canvasData
            const node = this.canvasData.nodes.find((n: any) => n.id === nodeId)
            if (!node) return

            if (node.type === 'file') {
                // File nodes: open in workspace
                const file = this.app.vault.getAbstractFileByPath(node.file) as TFile
                if (file) {
                    this.app.workspace.getLeaf('tab').openFile(file)
                }
            } else if (node.type === 'text') {
                // Text nodes: edit inline
                if (this.activeEditorNodeId === nodeId) return  // Already editing

                this.activeEditorNodeId = nodeId
                const textContainer = container.querySelector('.canvas-text-node') as HTMLElement
                if (!textContainer) return

                const originalText = node.text

                // Create editor
                const editorDiv = textContainer.parentElement!.createDiv('text-node-editor')
                const textarea = editorDiv.createEl('textarea', {
                    cls: 'fallback-inline-editor canvas-text-editor',
                    value: originalText
                })

                // Focus and select
                textarea.focus()
                textarea.select()

                // Create overlay
                const overlay = document.createElement('div')
                overlay.classList.add('focus-trap-overlay')
                overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999998;'
                document.body.appendChild(overlay)

                const doSave = async () => {
                    try {
                        node.text = textarea.value
                        this.canvasData.nodes = this.canvasData.nodes.map((n: any) =>
                            n.id === nodeId ? node : n
                        )

                        await this.app.vault.modify(
                            this.currentCanvas!,
                            JSON.stringify(this.canvasData, null, 2)
                        )

                        console.log(`✓ Saved text node: ${nodeId}`)
                        editorDiv.remove()
                        overlay.remove()
                        this.activeEditorNodeId = null

                        // Re-render node
                        const nodeEl = this.nodeElements.get(nodeId)
                        if (nodeEl) {
                            const contentDiv = nodeEl.querySelector('.file-content')
                            if (contentDiv) {
                                contentDiv.empty()
                                const newTextContainer = contentDiv.createDiv('canvas-text-node')
                                await MarkdownRenderer.renderMarkdown(
                                    node.text,
                                    newTextContainer,
                                    this.currentCanvas!.path,
                                    // @ts-ignore
                                    null
                                )
                            }
                        }
                    } catch (error) {
                        console.error('Error saving text node:', error)
                        new Notice('Failed to save text node')
                    }
                }

                const saveHandler = (e: KeyboardEvent) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault()
                        doSave()
                        return
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault()
                        editorDiv.remove()
                        overlay.remove()
                        this.activeEditorNodeId = null
                    }
                }

                textarea.addEventListener('keydown', saveHandler)
                overlay.addEventListener('click', doSave)
            }
        })
    }

    async onClose(): Promise<void> {
        console.log('🔴 CanvasNodesContinuousView closing')
        this.fileRenderer = null
        this.scrollManager?.cleanup()
        this.scrollManager = null
        this.nodeElements.clear()
    }
}
