# Enhanced Continuous Mode

Enhanced Continuous Mode is an Obsidian plugin that provides multiple continuous scrolling views for different content types, allowing you to seamlessly browse through multiple files, tabs, and canvas nodes in a single, unified view.

## Features

### 🗂️ Folder Continuous View
View all markdown files in a selected folder in a continuous scrolling interface. Perfect for reviewing related notes, reading through a project's documentation, or navigating long-form content spread across multiple files.

**Key capabilities:**
- Browse entire folders without switching between files
- Intelligent memory management with dynamic loading/unloading
- File explorer synchronization (highlights current file as you scroll)
- Double-click to edit files inline
- Individual file close buttons to remove files from view
- Scroll indicators showing available content above/below

### 📑 Tabs Continuous View
Display all currently open tabs in a continuous scrollable format. Ideal for working sessions where you have multiple files open and want to see them all at once.

**Key capabilities:**
- View all open markdown tabs in one scrollable view
- Automatically updates when tabs are opened or closed
- Synchronized with file explorer highlighting
- Inline editing with double-click
- Shows tab count in view header

### 🎨 Canvas Nodes Continuous View
View all text and file nodes from a canvas file in a continuous reading format, sorted by position (left-to-right, top-to-bottom).

**Key capabilities:**
- Displays canvas content in a linear, readable format
- Supports both text nodes (markdown) and file nodes (full file content)
- Inline editing for both text and file nodes
- Auto-updates when switching between canvas files
- Preserves canvas structure while providing continuous reading flow

## Usage

### Opening Views

#### Command Palette
Press `Ctrl/Cmd + P` to open the command palette, then search for:
- **"Open folder in continuous view"** - Select a folder to view
- **"Continuous View (NEW): Show open tabs"** - View all open tabs
- **"Continuous View: Show canvas nodes"** - View canvas nodes (requires an active canvas file)

#### Context Menus
- **Folder context menu**: Right-click any folder in the file explorer → "Open in continuous view"
- **Tab context menu**: Right-click any tab → "Show in Continuous View"
- **Tab group menu**: Click the tab group dropdown (≡) → "Continuous View"

#### Ribbon Icon
Click the scroll icon (📜) in the left ribbon to open the folder selection modal.

### Interacting with Content

#### Scrolling
- Scroll naturally through the content
- Scroll indicators (⇈ ⇊) show when more content is available
- Files load/unload automatically as you scroll to maintain performance

#### Editing
- **Double-click** any file content to edit inline
- Press `Ctrl/Cmd + Enter` to save changes
- Press `Escape` to cancel editing
- Click outside the editor to save and close

#### File Management
- Click the **×** button on any file header to remove it from the view
- Click file titles to open them in a new tab

## Settings

Access plugin settings via **Settings → Enhanced Continuous Mode**.

### Initial File Count
**Default:** 5

The number of files to load when first opening a continuous view. Lower values improve initial load time; higher values reduce scrolling triggers.

### Max File Count
**Default:** 7

Maximum number of files kept in memory simultaneously. When this limit is reached, files at the opposite end of your scroll position are unloaded to maintain performance.

### Load/Unload Count
**Default:** 2

How many files to load or unload at once when scrolling reaches the beginning or end of loaded content. Higher values reduce scrolling interruptions but increase memory usage.

### Scroll Threshold
**Default:** 0.1

Sensitivity for triggering file loading (0.0 to 1.0). Lower values load content earlier; higher values wait until you're closer to the edge.

## Installation

### From Obsidian Community Plugins (Recommended)
1. Open Obsidian Settings
2. Navigate to **Community plugins**
3. Click **Browse** and search for "Enhanced Continuous Mode"
4. Click **Install**, then **Enable**

### Manual Installation
1. Download the latest release from [GitHub Releases](https://github.com/aikruger/folder-continuous-mode/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` into your vault's plugins folder:
   ```
   VaultFolder/.obsidian/plugins/enhanced-continuous-mode/
   ```
3. Reload Obsidian
4. Enable the plugin in **Settings → Community plugins**

## Development

### Prerequisites
- Node.js (v16 or later recommended)
- npm (comes with Node.js)
- Git

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/aikruger/folder-continuous-mode.git
   cd folder-continuous-mode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

### Development Workflow

#### Watch Mode
For active development with automatic rebuilding:
```bash
npm run dev
```

This runs esbuild in watch mode, automatically recompiling when you save changes.

#### Testing in Obsidian
1. Build the plugin (or run in watch mode)
2. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder:
   ```
   /path/to/vault/.obsidian/plugins/enhanced-continuous-mode/
   ```
3. Reload Obsidian or use the "Reload app without saving" command
4. Enable the plugin in settings if not already enabled

#### Production Build
```bash
npm run build
```

This runs TypeScript type checking followed by an optimized esbuild production build.

### Project Structure

```
src/
  main.ts                  # Plugin entry point, lifecycle management
  view.ts                  # Folder Continuous View implementation
  settings.ts              # Settings interface and UI
  folderModal.ts           # Folder selection modal
  types.ts                 # TypeScript type definitions
  views/
    TabsContinuousView.ts         # Tabs Continuous View
    CanvasNodesContinuousView.ts  # Canvas Nodes Continuous View
  services/
    FileRenderer.ts        # File content rendering service
    FileHighlighter.ts     # File explorer highlighting
    ScrollManager.ts       # Infinite scroll management
    TabsManager.ts         # Tab tracking service
```

## Technical Architecture

### View Types
The plugin registers three custom Obsidian view types:
- `enhanced-continuous-view` - Folder view
- `tabs-continuous-view` - Tabs view
- `canvas-nodes-continuous-view` - Canvas nodes view

Each view extends Obsidian's `ItemView` class and can be opened in any leaf (pane).

### Memory Management
To prevent performance issues with large folders or many tabs, the plugin implements:

1. **Dynamic Loading**: Files load on-demand as you scroll
2. **Automatic Unloading**: Oldest files are removed when max capacity is reached
3. **Intersection Observers**: Efficient detection of scroll position and visible files
4. **File Highlighting**: Automatic explorer highlighting follows your scroll position

### Services
- **FileRenderer**: Handles markdown rendering using Obsidian's native renderer
- **ScrollManager**: Manages infinite scroll behavior and viewport state
- **FileHighlighter**: Synchronizes file explorer highlighting with scroll position
- **TabsManager**: Tracks and monitors open tabs

## Roadmap

### Planned Features
- [ ] Search within continuous view
- [ ] Customizable sorting options (alphabetical, modified date, created date)
- [ ] Tag-based continuous views
- [ ] Export continuous view to single markdown file
- [ ] Bookmark positions within continuous views
- [ ] Keyboard shortcuts for navigation
- [ ] Custom CSS themes for view appearance

### Known Issues
- TypeScript compilation shows type errors (functionality works correctly)
- Canvas node editing requires double-click (single-click behavior varies)
- Very large canvases (>100 nodes) may experience initial load delay

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

Created by [Jules](https://github.com/aikruger)

Built with the [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)

## Support

If you find this plugin helpful, consider:
- Starring the repository on GitHub
- Sharing it with other Obsidian users
- Reporting bugs or suggesting features via GitHub Issues

---

**Note**: This plugin requires Obsidian v0.15.0 or higher.
