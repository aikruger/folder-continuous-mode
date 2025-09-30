import { App, SuggestModal, TFolder } from 'obsidian';

export class FolderSuggestionModal extends SuggestModal<TFolder> {
    private onChoose: (folder: TFolder) => void;

    constructor(app: App, onChoose: (folder: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("Select a folder");
    }

    getSuggestions(query: string): TFolder[] {
        const folders = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder) as TFolder[];
        if (query === "") {
            return folders;
        }
        return folders.filter(folder => folder.path.toLowerCase().includes(query.toLowerCase()));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement) {
        el.createEl("div", { text: folder.path });
    }

    onChooseSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(folder);
    }
}