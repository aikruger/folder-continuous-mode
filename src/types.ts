import type { TFile, WorkspaceLeaf } from "obsidian";

// Shared file info
export interface FileInfo {
  file: TFile;
  path: string;
}

// Representation of an open tab (markdown leaf)
export interface TabInfo {
  file: TFile;
  leaf: WorkspaceLeaf;
  isActive: boolean;
  title: string;
}

// Scroll manager configuration
export interface ScrollManagerOptions {
  maxFiles: number;
  loadCount: number;
  rootMargin?: string;
  threshold?: number;
}

// Callbacks
export type TabChangeCallback = (tab: TabInfo) => void;
export type ScrollLoadMoreCallback = (direction: "next" | "previous") => void;
