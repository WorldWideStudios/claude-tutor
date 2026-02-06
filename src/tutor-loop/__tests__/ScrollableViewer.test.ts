import { ScrollableViewer, CursorManager } from "../ScrollableViewer.js";

describe("ScrollableViewer", () => {
  describe("viewport management", () => {
    it("should initialize with default values", () => {
      const viewer = new ScrollableViewer();
      expect(viewer.offset).toBe(0);
      expect(viewer.viewportHeight).toBeGreaterThanOrEqual(3);
      expect(viewer.totalLines).toBe(0);
    });

    it("should allow setting total lines", () => {
      const viewer = new ScrollableViewer();
      viewer.totalLines = 50;
      expect(viewer.totalLines).toBe(50);
    });

    it("should clamp scroll offset when total lines shrinks", () => {
      const viewer = new ScrollableViewer();
      viewer.totalLines = 100;
      viewer.scrollDown(50);
      expect(viewer.offset).toBeGreaterThan(0);

      viewer.totalLines = 5;
      expect(viewer.offset).toBeLessThanOrEqual(
        Math.max(0, 5 - viewer.viewportHeight),
      );
    });
  });

  describe("scrolling", () => {
    let viewer: ScrollableViewer;

    beforeEach(() => {
      viewer = new ScrollableViewer();
      viewer.totalLines = 100;
    });

    it("should scroll down", () => {
      expect(viewer.offset).toBe(0);
      const scrolled = viewer.scrollDown(5);
      expect(scrolled).toBe(true);
      expect(viewer.offset).toBe(5);
    });

    it("should scroll up", () => {
      viewer.scrollDown(10);
      expect(viewer.offset).toBe(10);
      const scrolled = viewer.scrollUp(3);
      expect(scrolled).toBe(true);
      expect(viewer.offset).toBe(7);
    });

    it("should not scroll above 0", () => {
      viewer.scrollDown(5);
      viewer.scrollUp(10);
      expect(viewer.offset).toBe(0);
    });

    it("should not scroll past content", () => {
      viewer.scrollDown(1000);
      const maxOffset = Math.max(0, 100 - viewer.viewportHeight);
      expect(viewer.offset).toBe(maxOffset);
    });

    it("should return false when scroll has no effect", () => {
      expect(viewer.scrollUp()).toBe(false);
    });
  });

  describe("scroll indicators", () => {
    let viewer: ScrollableViewer;

    beforeEach(() => {
      viewer = new ScrollableViewer();
      viewer.totalLines = 100;
    });

    it("should indicate more content above when scrolled down", () => {
      expect(viewer.hasMoreAbove).toBe(false);
      viewer.scrollDown(10);
      expect(viewer.hasMoreAbove).toBe(true);
      expect(viewer.linesAbove).toBe(10);
    });

    it("should indicate more content below when not at bottom", () => {
      expect(viewer.hasMoreBelow).toBe(true);
      expect(viewer.linesBelow).toBeGreaterThan(0);
    });

    it("should not indicate more below when at bottom", () => {
      viewer.scrollDown(1000);
      expect(viewer.hasMoreBelow).toBe(false);
      expect(viewer.linesBelow).toBe(0);
    });
  });

  describe("ensureLineVisible", () => {
    let viewer: ScrollableViewer;

    beforeEach(() => {
      viewer = new ScrollableViewer();
      viewer.totalLines = 100;
    });

    it("should scroll down to make line visible", () => {
      const lineIndex = viewer.viewportHeight + 10;
      const scrolled = viewer.ensureLineVisible(lineIndex);
      expect(scrolled).toBe(true);
      expect(viewer.isLineVisible(lineIndex)).toBe(true);
    });

    it("should scroll up to make line visible", () => {
      viewer.scrollDown(50);
      const scrolled = viewer.ensureLineVisible(5);
      expect(scrolled).toBe(true);
      expect(viewer.isLineVisible(5)).toBe(true);
    });

    it("should return false if line already visible", () => {
      const scrolled = viewer.ensureLineVisible(0);
      expect(scrolled).toBe(false);
    });
  });

  describe("getVisibleRange", () => {
    it("should return correct visible range", () => {
      const viewer = new ScrollableViewer();
      viewer.totalLines = 100;
      viewer.scrollDown(10);

      const { start, end } = viewer.getVisibleRange();
      expect(start).toBe(10);
      expect(end).toBe(10 + viewer.viewportHeight);
    });

    it("should clamp end to total lines", () => {
      const viewer = new ScrollableViewer();
      viewer.totalLines = 5;

      const { start, end } = viewer.getVisibleRange();
      expect(start).toBe(0);
      expect(end).toBe(5);
    });
  });

  describe("reset", () => {
    it("should reset scroll position and total lines", () => {
      const viewer = new ScrollableViewer();
      viewer.totalLines = 100;
      viewer.scrollDown(50);

      viewer.reset();

      expect(viewer.offset).toBe(0);
      expect(viewer.totalLines).toBe(0);
    });
  });
});

describe("CursorManager", () => {
  describe("initialization", () => {
    it("should start with empty buffer and position 0", () => {
      const cursor = new CursorManager();
      expect(cursor.buffer).toBe("");
      expect(cursor.position).toBe(0);
      expect(cursor.length).toBe(0);
    });
  });

  describe("insertion", () => {
    it("should insert at cursor position", () => {
      const cursor = new CursorManager();
      cursor.insert("a");
      cursor.insert("b");
      cursor.insert("c");
      expect(cursor.buffer).toBe("abc");
      expect(cursor.position).toBe(3);
    });

    it("should insert in the middle", () => {
      const cursor = new CursorManager();
      cursor.setBuffer("ac");
      cursor.moveLeft();
      cursor.insert("b");
      expect(cursor.buffer).toBe("abc");
      expect(cursor.position).toBe(2);
    });
  });

  describe("cursor movement", () => {
    let cursor: CursorManager;

    beforeEach(() => {
      cursor = new CursorManager();
      cursor.setBuffer("hello");
    });

    it("should move left", () => {
      expect(cursor.position).toBe(5);
      cursor.moveLeft();
      expect(cursor.position).toBe(4);
    });

    it("should move right", () => {
      cursor.moveLeft(3);
      expect(cursor.position).toBe(2);
      cursor.moveRight();
      expect(cursor.position).toBe(3);
    });

    it("should not move left past 0", () => {
      cursor.moveLeft(10);
      expect(cursor.position).toBe(0);
      const moved = cursor.moveLeft();
      expect(moved).toBe(false);
      expect(cursor.position).toBe(0);
    });

    it("should not move right past buffer length", () => {
      const moved = cursor.moveRight();
      expect(moved).toBe(false);
      expect(cursor.position).toBe(5);
    });

    it("should return true when movement occurred", () => {
      expect(cursor.moveLeft()).toBe(true);
      expect(cursor.moveRight()).toBe(true);
    });
  });

  describe("deletion", () => {
    let cursor: CursorManager;

    beforeEach(() => {
      cursor = new CursorManager();
      cursor.setBuffer("hello");
    });

    it("should delete character before cursor (backspace)", () => {
      cursor.deleteBack();
      expect(cursor.buffer).toBe("hell");
      expect(cursor.position).toBe(4);
    });

    it("should delete character at cursor (delete)", () => {
      cursor.moveLeft(2);
      cursor.deleteForward();
      expect(cursor.buffer).toBe("helo");
      expect(cursor.position).toBe(3);
    });

    it("should return false when nothing to delete", () => {
      cursor.moveLeft(10);
      expect(cursor.deleteBack()).toBe(false);

      cursor.moveRight(10);
      expect(cursor.deleteForward()).toBe(false);
    });
  });

  describe("setBuffer", () => {
    it("should set buffer and position cursor at end", () => {
      const cursor = new CursorManager();
      cursor.setBuffer("test");
      expect(cursor.buffer).toBe("test");
      expect(cursor.position).toBe(4);
    });
  });

  describe("reset", () => {
    it("should clear buffer and position", () => {
      const cursor = new CursorManager();
      cursor.setBuffer("test");
      cursor.reset();
      expect(cursor.buffer).toBe("");
      expect(cursor.position).toBe(0);
    });
  });
});
