import { Plugin, WorkspaceLeaf, TFolder } from 'obsidian';
import { EnhancedContinuousView, ENHANCED_CONTINUOUS_VIEW_TYPE } from './view';
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

        // Add ribbon icon
        this.addRibbonIcon('scroll', 'Enhanced Continuous Mode', () => {
            new FolderSuggestionModal(this.app, (folder: TFolder) => {
                this.activateView(folder);
            }).open();
        });
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