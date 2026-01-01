import { App, SuggestModal, TFile } from 'obsidian';

export class CanvasSuggestionModal extends SuggestModal<TFile> {
    private onChoose: (file: TFile) => void;

    constructor(app: App, onChoose: (file: TFile) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("Select a canvas file");
    }

    getSuggestions(query: string): TFile[] {
        const files = this.app.vault.getFiles().filter(f => f.extension === 'canvas');

        if (query === "") {
            return files.sort((a, b) => a.basename.localeCompare(b.basename));
        }

        return files
            .filter(file => file.path.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) => a.basename.localeCompare(b.basename));
    }

    renderSuggestion(file: TFile, el: HTMLElement) {
        el.createEl("div", { text: file.basename });
        el.createEl("div", {
            text: file.path,
            cls: "suggestion-note",
            attr: { style: "font-size: 0.8em; color: var(--text-muted);" }
        });
    }

    onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(file);
    }
}
