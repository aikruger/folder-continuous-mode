import { Plugin, WorkspaceLeaf, TFolder } from 'obsidian';
import { EnhancedContinuousView, ENHANCED_CONTINUOUS_VIEW_TYPE } from './view';
import { TabsContinuousView, TABS_VIEW_TYPE } from "./views/TabsContinuousView";
import { CanvasContinuousView, CANVAS_VIEW_TYPE } from "./views/CanvasContinuousView";
import { EnhancedContinuousModeSettings, DEFAULT_SETTINGS, EnhancedContinuousModeSettingTab } from './settings';
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
        this.registerView(
            TABS_VIEW_TYPE,
            (leaf) => new TabsContinuousView(leaf)
        );
        this.registerView(
            CANVAS_VIEW_TYPE,
            (leaf) => new CanvasContinuousView(leaf)
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
        this.addCommand({
            id: "open-tabs-continuous-view-new",
            name: "Continuous View (NEW): Show open tabs",
            callback: async () => {
                const leaf = this.app.workspace.getLeaf("split");
                await leaf.setViewState({
                    type: TABS_VIEW_TYPE,
                    active: true,
                });
            },
        });
        this.addCommand({
            id: "open-canvas-continuous-view",
            name: "Continuous View: Show canvas files",
            callback: async () => {
                const leaf = this.app.workspace.getLeaf("split");
                await leaf.setViewState({
                    type: CANVAS_VIEW_TYPE,
                    active: true,
                });
            },
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