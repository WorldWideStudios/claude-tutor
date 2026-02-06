import terminalSize from "terminal-size";

/**
 * Manages viewport state for scrollable code display.
 * Handles scroll position, viewport sizing, and auto-scroll on line completion.
 */
export class ScrollableViewer {
  private scrollOffset: number = 0;
  private _viewportHeight: number = 10;
  private _totalLines: number = 0;
  private resizeHandler: (() => void) | null = null;

  // UI chrome lines: separator (1) + input line (1) + bottom bar (1) + mode footer (1) = 4
  // Plus some padding for explanation and buffer
  private static readonly UI_CHROME_LINES = 6;
  private static readonly MIN_VIEWPORT_HEIGHT = 3;

  constructor() {
    this.updateViewportHeight();
  }

  /**
   * Get current viewport height (visible code lines)
   */
  get viewportHeight(): number {
    return this._viewportHeight;
  }

  /**
   * Get total number of lines in the content
   */
  get totalLines(): number {
    return this._totalLines;
  }

  /**
   * Set total number of lines and reset scroll if needed
   */
  set totalLines(count: number) {
    this._totalLines = count;
    // Clamp scroll offset if content shrunk
    this.scrollOffset = Math.min(
      this.scrollOffset,
      Math.max(0, count - this._viewportHeight),
    );
  }

  /**
   * Get current scroll offset (first visible line index)
   */
  get offset(): number {
    return this.scrollOffset;
  }

  /**
   * Check if content extends above the viewport
   */
  get hasMoreAbove(): boolean {
    return this.scrollOffset > 0;
  }

  /**
   * Check if content extends below the viewport
   */
  get hasMoreBelow(): boolean {
    return this.scrollOffset + this._viewportHeight < this._totalLines;
  }

  /**
   * Get count of lines above viewport
   */
  get linesAbove(): number {
    return this.scrollOffset;
  }

  /**
   * Get count of lines below viewport
   */
  get linesBelow(): number {
    return Math.max(
      0,
      this._totalLines - this.scrollOffset - this._viewportHeight,
    );
  }

  /**
   * Update viewport height based on current terminal size
   */
  updateViewportHeight(): void {
    const size = terminalSize();
    const rows = size?.rows ?? process.stdout.rows ?? 24;
    this._viewportHeight = Math.max(
      ScrollableViewer.MIN_VIEWPORT_HEIGHT,
      rows - ScrollableViewer.UI_CHROME_LINES,
    );
  }

  /**
   * Scroll up by n lines
   */
  scrollUp(n: number = 1): boolean {
    const newOffset = Math.max(0, this.scrollOffset - n);
    if (newOffset !== this.scrollOffset) {
      this.scrollOffset = newOffset;
      return true;
    }
    return false;
  }

  /**
   * Scroll down by n lines
   */
  scrollDown(n: number = 1): boolean {
    const maxOffset = Math.max(0, this._totalLines - this._viewportHeight);
    const newOffset = Math.min(maxOffset, this.scrollOffset + n);
    if (newOffset !== this.scrollOffset) {
      this.scrollOffset = newOffset;
      return true;
    }
    return false;
  }

  /**
   * Ensure a specific line index is visible in the viewport.
   * If the line is below the viewport, scroll down to show it at the bottom.
   * If the line is above the viewport, scroll up to show it at the top.
   */
  ensureLineVisible(lineIndex: number): boolean {
    // If line is above viewport, scroll up
    if (lineIndex < this.scrollOffset) {
      this.scrollOffset = lineIndex;
      return true;
    }

    // If line is below viewport, scroll down to put it at bottom
    if (lineIndex >= this.scrollOffset + this._viewportHeight) {
      this.scrollOffset = lineIndex - this._viewportHeight + 1;
      return true;
    }

    return false;
  }

  /**
   * Reset scroll position to top
   */
  reset(): void {
    this.scrollOffset = 0;
    this._totalLines = 0;
  }

  /**
   * Get the range of line indices currently visible
   */
  getVisibleRange(): { start: number; end: number } {
    return {
      start: this.scrollOffset,
      end: Math.min(this.scrollOffset + this._viewportHeight, this._totalLines),
    };
  }

  /**
   * Check if a specific line index is visible
   */
  isLineVisible(lineIndex: number): boolean {
    return (
      lineIndex >= this.scrollOffset &&
      lineIndex < this.scrollOffset + this._viewportHeight
    );
  }

  /**
   * Start listening for terminal resize events
   */
  startResizeListener(onResize: () => void): void {
    this.resizeHandler = () => {
      this.updateViewportHeight();
      onResize();
    };
    process.stdout.on("resize", this.resizeHandler);
  }

  /**
   * Stop listening for terminal resize events
   */
  stopResizeListener(): void {
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
  }
}

/**
 * Manages cursor position within an input line.
 * Allows left/right arrow navigation and insertion/deletion at cursor.
 */
export class CursorManager {
  private _position: number = 0;
  private _buffer: string = "";

  /**
   * Get current cursor position (0 to buffer.length)
   */
  get position(): number {
    return this._position;
  }

  /**
   * Get current buffer content
   */
  get buffer(): string {
    return this._buffer;
  }

  /**
   * Get buffer length
   */
  get length(): number {
    return this._buffer.length;
  }

  /**
   * Reset cursor and buffer
   */
  reset(): void {
    this._position = 0;
    this._buffer = "";
  }

  /**
   * Move cursor left by n positions
   */
  moveLeft(n: number = 1): boolean {
    const newPos = Math.max(0, this._position - n);
    if (newPos !== this._position) {
      this._position = newPos;
      return true;
    }
    return false;
  }

  /**
   * Move cursor right by n positions
   */
  moveRight(n: number = 1): boolean {
    const newPos = Math.min(this._buffer.length, this._position + n);
    if (newPos !== this._position) {
      this._position = newPos;
      return true;
    }
    return false;
  }

  /**
   * Insert a character at cursor position
   */
  insert(char: string): void {
    this._buffer =
      this._buffer.slice(0, this._position) +
      char +
      this._buffer.slice(this._position);
    this._position += char.length;
  }

  /**
   * Delete character before cursor (backspace)
   */
  deleteBack(): boolean {
    if (this._position > 0) {
      this._buffer =
        this._buffer.slice(0, this._position - 1) +
        this._buffer.slice(this._position);
      this._position--;
      return true;
    }
    return false;
  }

  /**
   * Delete character at cursor (delete key)
   */
  deleteForward(): boolean {
    if (this._position < this._buffer.length) {
      this._buffer =
        this._buffer.slice(0, this._position) +
        this._buffer.slice(this._position + 1);
      return true;
    }
    return false;
  }

  /**
   * Set buffer content and position cursor at end
   */
  setBuffer(content: string): void {
    this._buffer = content;
    this._position = content.length;
  }

  /**
   * Get display string with cursor indicator for debugging
   */
  getDisplayWithCursor(): string {
    return (
      this._buffer.slice(0, this._position) +
      "|" +
      this._buffer.slice(this._position)
    );
  }
}
