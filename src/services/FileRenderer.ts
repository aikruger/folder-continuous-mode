import { TFile, MarkdownRenderer, App } from "obsidian";

export class FileRenderer {
  constructor(private app: App) {}

  async createFileElement(file: TFile): Promise<HTMLElement> {
    const container = document.createElement("div");
    container.classList.add("file-container");
    container.dataset.filePath = file.path;

    // Header with title + close button
    const header = container.createDiv("file-header");
    const titleGroup = header.createDiv("file-title-group");

    const title = titleGroup.createEl("h2", {
        text: file.basename,
        cls: "file-title",
    });
    title.style.cursor = "pointer";
    title.addEventListener("click", () => {
        this.app.workspace.getLeaf("tab").openFile(file);
    });

    // Close button (×)
    const closeBtn = header.createEl("button", {
        cls: "file-close-btn",
        attr: { "aria-label": `Remove ${file.basename} from view` },
    });
    closeBtn.innerHTML = "×";
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        console.log(`🔴 FileRenderer: User clicked close on ${file.basename}`);
        // Dispatch custom event so the parent view can handle removal
        container.dispatchEvent(
            new CustomEvent("file-remove-requested", { detail: { file } })
        );
    });

    // Content area
    const content = container.createDiv("file-content");
    await this.renderFileContent(file, content);

    return container;
  }

  private async renderFileContent(
    file: TFile,
    container: HTMLElement
  ): Promise<void> {
    try {
      const markdown = await this.app.vault.read(file);
      await MarkdownRenderer.renderMarkdown(
        markdown,
        container,
        file.path,
        // `null` as component is acceptable; you can tighten this later
        null as any
      );
    } catch (error) {
      console.error(`Failed to render ${file.path}:`, error);
      container.setText(
        `Error rendering file: ${(error as Error)?.message ?? "unknown"}`
      );
    }
  }
}
