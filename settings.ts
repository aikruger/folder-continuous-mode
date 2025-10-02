import { App, PluginSettingTab, Setting } from 'obsidian';
import EnhancedContinuousModePlugin from './main';

export interface EnhancedContinuousModeSettings {
    initialFileCount: number;
    maxFileCount: number;
    loadUnloadCount: number;
    scrollThreshold: number;
    preserveEditorFocus: boolean;
}

export const DEFAULT_SETTINGS: EnhancedContinuousModeSettings = {
    initialFileCount: 5,
    maxFileCount: 7,
    loadUnloadCount: 2,
    scrollThreshold: 0.1,
    preserveEditorFocus: true
};

export class EnhancedContinuousModeSettingTab extends PluginSettingTab {
    plugin: EnhancedContinuousModePlugin;

    constructor(app: App, plugin: EnhancedContinuousModePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Enhanced Continuous Mode Settings' });

        new Setting(containerEl)
            .setName('Initial File Count')
            .setDesc('The number of files to load initially.')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(this.plugin.settings.initialFileCount.toString())
                .onChange(async (value) => {
                    this.plugin.settings.initialFileCount = Number(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max File Count')
            .setDesc('The maximum number of files to have loaded at once.')
            .addText(text => text
                .setPlaceholder('7')
                .setValue(this.plugin.settings.maxFileCount.toString())
                .onChange(async (value) => {
                    this.plugin.settings.maxFileCount = Number(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Load/Unload Count')
            .setDesc('The number of files to load/unload when scrolling to the beginning or end.')
            .addText(text => text
                .setPlaceholder('2')
                .setValue(this.plugin.settings.loadUnloadCount.toString())
                .onChange(async (value) => {
                    this.plugin.settings.loadUnloadCount = Number(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Scroll Threshold')
            .setDesc('The scroll threshold (0.0 to 1.0) for triggering file loading.')
            .addText(text => text
                .setPlaceholder('0.1')
                .setValue(this.plugin.settings.scrollThreshold.toString())
                .onChange(async (value) => {
                    this.plugin.settings.scrollThreshold = Number(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Preserve Editor Focus')
            .setDesc('Keep focus in active editors when clicking on continuous view content. When enabled, clicking on content will show a tooltip instead of opening the file if you are actively editing elsewhere.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preserveEditorFocus)
                .onChange(async (value) => {
                    this.plugin.settings.preserveEditorFocus = value;
                    await this.plugin.saveSettings();
                }));
    }
}