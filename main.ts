import { Plugin, WorkspaceLeaf, TFolder, Notice, TFile } from 'obsidian';
import { EnhancedContinuousView, ENHANCED_CONTINUOUS_VIEW_TYPE } from './view';
import { EnhancedContinuousModeSettings, DEFAULT_SETTINGS, EnhancedContinuousModeSettingTab, CONTINUOUS_MODES } from './settings';
import { FolderSuggestionModal } from './folderModal';

export default class EnhancedContinuousModePlugin extends Plugin {
    settings: EnhancedContinuousModeSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new EnhancedContinuousModeSettingTab(this.app, this));

        // Register the custom view
        this.registerView(
            ENHANCED_CONTINUOUS_VIEW_TYPE,
            (leaf) => new EnhancedContinuousView(leaf, this)
        );

        // Add commands
        this.addCommand({
            id: 'open-folder-continuous-view',
            name: 'Open folder in continuous view',
            callback: () => {
                new FolderSuggestionModal(this.app, (folder: TFolder) => {
                    this.activateView(folder);
                }).open();
            }
        });

        // NEW: Open tabs command
        this.addCommand({
            id: 'open-tabs-continuous-view',
            name: 'Open current tabs in continuous view',
            callback: async () => {
                this.app.workspace.detachLeavesOfType(ENHANCED_CONTINUOUS_VIEW_TYPE);
                const leaf = this.app.workspace.getLeaf('split');
                await leaf.setViewState({ type: ENHANCED_CONTINUOUS_VIEW_TYPE, active: true });
                this.app.workspace.revealLeaf(leaf);

                if (leaf.view instanceof EnhancedContinuousView) {
                    leaf.view.currentMode = CONTINUOUS_MODES.TABS;
                    await leaf.view.loadOpenTabsContinuous();
                }
            }
        });

        // NEW: Canvas command
        this.addCommand({
            id: 'open-canvas-continuous-view',
            name: 'Open canvas in continuous view',
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();

                if (!activeFile || activeFile.extension !== 'canvas') {
                    new Notice('Please open a canvas file first');
                    return;
                }

                this.app.workspace.detachLeavesOfType(ENHANCED_CONTINUOUS_VIEW_TYPE);
                const leaf = this.app.workspace.getLeaf('split');
                await leaf.setViewState({ type: ENHANCED_CONTINUOUS_VIEW_TYPE, active: true });
                this.app.workspace.revealLeaf(leaf);

                if (leaf.view instanceof EnhancedContinuousView) {
                    leaf.view.currentMode = CONTINUOUS_MODES.CANVAS;
                    await leaf.view.loadCanvasFiles(activeFile);
                }
            }
        });

        // Add ribbon icon
        this.addRibbonIcon('scroll', 'Enhanced Continuous Mode', () => {
            new FolderSuggestionModal(this.app, (folder: TFolder) => {
                this.activateView(folder);
            }).open();
        });

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle("Open in continuous view")
                            .setIcon("scroll")
                            .onClick(() => {
                                this.activateView(file as TFolder);
                            });
                    });
                }

                // NEW: Add canvas files to context menu
                if (file instanceof TFile && file.extension === 'canvas') {
                    menu.addItem((item) => {
                        item
                            .setTitle('Open in continuous view')
                            .setIcon('scroll')
                            .onClick(async () => {
                                this.app.workspace.detachLeavesOfType(ENHANCED_CONTINUOUS_VIEW_TYPE);
                                const leaf = this.app.workspace.getLeaf('split');
                                await leaf.setViewState({ type: ENHANCED_CONTINUOUS_VIEW_TYPE, active: true });
                                this.app.workspace.revealLeaf(leaf);

                                if (leaf.view instanceof EnhancedContinuousView) {
                                    leaf.view.currentMode = CONTINUOUS_MODES.CANVAS;
                                    await leaf.view.loadCanvasFiles(file);
                                }
                            });
                    });
                }
            })
        );
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(ENHANCED_CONTINUOUS_VIEW_TYPE);
    }

    async activateView(folder: TFolder) {
        this.app.workspace.detachLeavesOfType(ENHANCED_CONTINUOUS_VIEW_TYPE);

        const leaf = this.app.workspace.getLeaf('split');

        await leaf.setViewState({
            type: ENHANCED_CONTINUOUS_VIEW_TYPE,
            active: true,
        });

        this.app.workspace.revealLeaf(leaf);

        if (leaf.view instanceof EnhancedContinuousView) {
            leaf.view.loadFolder(folder);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}