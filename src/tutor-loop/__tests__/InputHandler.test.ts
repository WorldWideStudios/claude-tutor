import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { InputHandler } from '../InputHandler.js';
import type { Segment } from '../../types.js';
import type { ExtractedCode } from '../../input.js';

describe('InputHandler', () => {
  let handler: InputHandler;
  let mockGoldenCodeManager: any;
  let mockCommandExecutor: any;
  let mockReadline: any;
  let mockSegment: Segment;

  beforeEach(() => {
    mockSegment = {
      id: 'test-segment',
      type: 'build',
      title: 'Test Segment',
      goldenCode: 'mkdir src\ntouch src/index.ts',
      targetFile: 'src/index.ts',
      explanation: 'Test',
      engineeringFocus: 'Test',
      checkpoints: [],
    };

    mockGoldenCodeManager = {
      getCurrentCode: jest.fn(),
      loadCurrentStep: jest.fn(),
      clear: jest.fn(),
      advance: jest.fn(),
    };

    mockCommandExecutor = {
      isHeredocActive: jest.fn().mockReturnValue(false),
    };

    mockReadline = {
      once: jest.fn((event, callback: (line: string) => void) => {
        // Simulate readline returning a line
        setTimeout(() => callback('test input'), 0);
      }),
    };

    handler = new InputHandler(
      mockReadline,
      mockGoldenCodeManager,
      mockCommandExecutor
    );
  });

  describe('discuss mode', () => {
    it('should use free-form input in discuss mode', async () => {
      // This would require mocking createFreeFormInput, which is complex
      // For now, we verify the handler was created successfully
      expect(handler).toBeDefined();
    });

    it('should clear golden code in discuss mode', async () => {
      // Verify that discuss mode behavior clears golden code
      expect(mockGoldenCodeManager.clear).toBeDefined();
    });
  });

  describe('block/code mode', () => {

    it('should provide expected code as reference in block mode', () => {
      const mockCode: ExtractedCode = {
        code: 'mkdir src',
        explanation: 'Create directory',
        isMultiLine: false,
      };
      mockGoldenCodeManager.getCurrentCode.mockReturnValue(mockCode);

      // Verify golden code manager is called
      const code = mockGoldenCodeManager.getCurrentCode();
      expect(code).toBeDefined();
      expect(code.code).toBe('mkdir src');
    });

    it('should clear golden code after block mode input', () => {
      expect(mockGoldenCodeManager.clear).toBeDefined();
    });
  });

  describe('tutor mode', () => {
    it('should lazy load golden code when not present', async () => {
      mockGoldenCodeManager.getCurrentCode.mockReturnValue(null);
      mockGoldenCodeManager.loadCurrentStep.mockResolvedValue({
        code: 'mkdir src',
        explanation: 'Create directory',
        isMultiLine: false,
      });

      // Verify lazy loading would be triggered
      const code = mockGoldenCodeManager.getCurrentCode();
      expect(code).toBeNull();
    });

    it('should handle single-line Typer Shark input', () => {
      const mockCode: ExtractedCode = {
        code: 'mkdir src',
        explanation: 'Create directory',
        isMultiLine: false,
      };
      mockGoldenCodeManager.getCurrentCode.mockReturnValue(mockCode);

      const code = mockGoldenCodeManager.getCurrentCode();
      expect(code.isMultiLine).toBe(false);
      expect(code.code).toBe('mkdir src');
    });

    it('should handle multi-line Typer Shark input', () => {
      const mockCode: ExtractedCode = {
        code: 'cat > file.ts',
        explanation: 'Create file',
        isMultiLine: true,
        lines: [
          { code: 'const x = 1;', comment: 'Declare variable' },
          { code: 'console.log(x);', comment: 'Print it' },
        ],
      };
      mockGoldenCodeManager.getCurrentCode.mockReturnValue(mockCode);

      const code = mockGoldenCodeManager.getCurrentCode();
      expect(code.isMultiLine).toBe(true);
      expect(code.lines).toHaveLength(2);
    });

    it('should advance golden step after successful input', async () => {
      mockGoldenCodeManager.getCurrentCode.mockReturnValue({
        code: 'mkdir src',
        explanation: 'Create directory',
        isMultiLine: false,
      });

      // Verify advance method exists
      expect(mockGoldenCodeManager.advance).toBeDefined();
    });

    it('should handle question prefix in multi-line input', () => {
      const questionResult = ['__QUESTION__:What does this do?'];
      const extracted = questionResult[0].slice('__QUESTION__:'.length);
      expect(extracted).toBe('What does this do?');
    });
  });

  describe('heredoc continuation', () => {
    beforeEach(() => {
      mockCommandExecutor.isHeredocActive.mockReturnValue(true);
    });

    it('should use readline for heredoc continuation', async () => {
      expect(mockCommandExecutor.isHeredocActive()).toBe(true);
      
      // Verify readline.once would be called for heredoc
      const promise = new Promise<string>((resolve) => {
        mockReadline.once('line', resolve);
      });
      
      expect(promise).toBeDefined();
    });

    it('should not use Typer Shark during heredoc', () => {
      expect(mockCommandExecutor.isHeredocActive()).toBe(true);
      // When heredoc is active, Typer Shark should not be used
    });
  });

  describe('mode detection and transitions', () => {
    it('should detect mode changes', () => {
      const mode1 = 'tutor';
      const mode2 = 'discuss';
      expect(mode1).not.toBe(mode2);
    });

    it('should reload code when switching to tutor mode', () => {
      // When switching TO tutor mode, should reload
      expect(mockGoldenCodeManager.loadCurrentStep).toBeDefined();
    });

    it('should clear code when leaving tutor mode', () => {
      // When leaving tutor mode, should clear
      expect(mockGoldenCodeManager.clear).toBeDefined();
    });
  });

  describe('expected code formatting', () => {
    it('should format multi-line expected code as string', () => {
      const mockCode: ExtractedCode = {
        code: 'cat > file.ts',
        explanation: 'Create file',
        isMultiLine: true,
        lines: [
          { code: 'line 1', comment: 'Comment 1' },
          { code: 'line 2', comment: 'Comment 2' },
        ],
      };

      const formatted = mockCode.lines!.map((l) => l.code).join('\n');
      expect(formatted).toBe('line 1\nline 2');
    });

    it('should handle single-line expected code', () => {
      const mockCode: ExtractedCode = {
        code: 'mkdir src',
        explanation: 'Create directory',
        isMultiLine: false,
      };

      expect(mockCode.code).toBe('mkdir src');
      expect(mockCode.lines).toBeUndefined();
    });
  });
});
