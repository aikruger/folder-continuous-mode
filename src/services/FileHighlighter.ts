import { App, TFile, WorkspaceLeaf } from "obsidian";

export class FileHighlighter {
  private lastHighlighted: HTMLElement | null = null;

  constructor(private app: App) {}

  highlight(file: TFile): void {
    if (this.lastHighlighted) {
      this.lastHighlighted.removeClass("is-active-in-continuous-view");
      this.lastHighlighted = null;
    }

    const explorerLeaf = this.app.workspace
      .getLeavesOfType("file-explorer")
      .first();

    if (!explorerLeaf) return;

    const navElement = this.findNavElement(explorerLeaf, file);
    if (!navElement) return;

    navElement.addClass("is-active-in-continuous-view");
    this.lastHighlighted = navElement;

    try {
      navElement.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      // ignore scroll errors
    }
  }

  private findNavElement(
    explorerLeaf: WorkspaceLeaf,
    file: TFile
  ): HTMLElement | null {
    const explorerEl = explorerLeaf.view.containerEl;

    const direct = explorerEl.querySelector(
      `.nav-file-title[data-path="${file.path}"]`
    ) as HTMLElement | null;
    if (direct) return direct;

    const baseName = file.basename;
    const allTitles = explorerEl.querySelectorAll(".nav-file-title");
    for (const el of Array.from(allTitles)) {
      if (el.textContent?.trim() === baseName) {
        return el as HTMLElement;
      }
    }
    return null;
  }

  cleanup(): void {
    if (this.lastHighlighted) {
      this.lastHighlighted.removeClass("is-active-in-continuous-view");
      this.lastHighlighted = null;
    }
  }
}
