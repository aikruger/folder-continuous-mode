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

            // Separate node types
            const fileNodes = nodes.filter((n: any) => n.type === 'file' && n.file)
            const textNodes = nodes.filter((n: any) => n.type === 'text' && n.text)

            // Render file nodes first, then text nodes
            // Can be changed to sort by Y position if desired
            for (const node of [...fileNodes, ...textNodes]) {
                const element = await this.renderCanvasNode(node, canvasFile)
                if (element) {
                    this.contentContainer!.appendChild(element)
                    this.nodeElements.set(node.id, element)
                }
            }

            // Setup scroll observer
            this.scrollManager!.setData(fileNodes.concat(textNodes))

            new Notice(`Loaded ${fileNodes.length} file nodes and ${textNodes.length} text nodes`)

        } catch (error) {
            console.error('Error rendering canvas:', error)
            this.contentContainer!.setText(`Error loading canvas: ${(error as Error).message}`)
            new Notice('Failed to load canvas')
        }
    }

    private async renderCanvasNode(node: any, canvasFile: TFile): Promise<HTMLElement | null> {
        /**
         * Render a single canvas node (file or text).
         * Each node gets a close button, header, and content area.
         */
        const container = document.createElement('div')
        container.classList.add('canvas-node-container')
        container.dataset.nodeId = node.id

        // Create header
        const header = container.createDiv('file-header')
        const titleGroup = header.createDiv('file-title-group')

        if (node.type === 'file') {
            // ===== FILE NODE =====
            // Reference to another file; show its full content

            const referencedFile = this.app.vault.getAbstractFileByPath(node.file) as TFile
            if (!referencedFile) {
                console.warn(`Canvas file node references missing file: ${node.file}`)
                return null  // Skip if file doesn't exist
            }

            const title = titleGroup.createEl('h3', {
                text: `📄 ${referencedFile.basename}`,
                cls: 'file-title'
            })
            title.style.cursor = 'pointer'
            title.addEventListener('click', () => {
                this.app.workspace.getLeaf('tab').openFile(referencedFile)
            })

            // Close button
            const closeBtn = header.createEl('button', {
                cls: 'file-close-btn',
                attr: { 'aria-label': 'Remove node from view' }
            })
            closeBtn.innerHTML = '×'
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                console.log(`🗑️  Removing canvas node: ${node.id}`)
                container.remove()
                this.nodeElements.delete(node.id)
            })

            // Render file content
            const content = container.createDiv('file-content')
            await this.renderFileContent(referencedFile, content)

            return container

        } else if (node.type === 'text') {
            // ===== TEXT NODE =====
            // Markdown text box from canvas

            const preview = node.text.substring(0, 60).replace(/\n/g, ' ')
            const title = titleGroup.createEl('h3', {
                text: `💬 ${preview}...`,
                cls: 'file-title'
            })

            // Close button
            const closeBtn = header.createEl('button', {
                cls: 'file-close-btn',
                attr: { 'aria-label': 'Remove node from view' }
            })
            closeBtn.innerHTML = '×'
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                console.log(`🗑️  Removing text node: ${node.id}`)
                container.remove()
                this.nodeElements.delete(node.id)
            })

            // Render text as markdown
            const content = container.createDiv('file-content')
            const textContainer = content.createDiv('canvas-text-node')

            try {
                await MarkdownRenderer.renderMarkdown(
                    node.text,
                    textContainer,
                    canvasFile.path,
                    // @ts-ignore
                    null
                )
            } catch (error) {
                console.error('Error rendering canvas text node:', error)
                textContainer.setText(node.text)
            }

            return container
        }

        return null
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
