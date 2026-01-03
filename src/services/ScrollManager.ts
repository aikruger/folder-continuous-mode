import { ScrollManagerOptions, ScrollLoadMoreCallback } from "../types";

export class ScrollManager {
  private observer: IntersectionObserver | null = null;
  private topSentinel: HTMLElement;
  private bottomSentinel: HTMLElement;
  private onLoadMoreCallback: ScrollLoadMoreCallback | null = null;

  constructor(
    private contentContainer: HTMLElement,
    private options: ScrollManagerOptions
  ) {
    this.topSentinel = this.createSentinel("top");
    this.bottomSentinel = this.createSentinel("bottom");

    // Insert sentinels
    this.contentContainer.insertBefore(
      this.topSentinel,
      this.contentContainer.firstChild
    );
    this.contentContainer.appendChild(this.bottomSentinel);

    this.setupObserver();
  }

  private createSentinel(position: "top" | "bottom"): HTMLElement {
    const el = document.createElement("div");
    el.classList.add("scroll-sentinel", `scroll-sentinel-${position}`);
    el.style.cssText = "height: 1px; opacity: 0; pointer-events: none;";
    return el;
  }

  private setupObserver(): void {
    const options: IntersectionObserverInit = {
      root: this.contentContainer,
      rootMargin: this.options.rootMargin ?? "100px 0px",
      threshold: this.options.threshold ?? 0.1,
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        if (entry.target === this.topSentinel) {
          this.onLoadMoreCallback?.("previous");
        } else if (entry.target === this.bottomSentinel) {
          this.onLoadMoreCallback?.("next");
        }
      });
    }, options);

    this.observer.observe(this.topSentinel);
    this.observer.observe(this.bottomSentinel);
  }

  onLoadMore(callback: ScrollLoadMoreCallback): void {
    this.onLoadMoreCallback = callback;
  }

  cleanup(): void {
    this.observer?.disconnect();
    this.topSentinel.remove();
    this.bottomSentinel.remove();
    this.onLoadMoreCallback = null;
  }
}
