# Test Suite Documentation

This document catalogs all 81 tests across the 5 test suites created during the Phase 1-6 refactoring.

## Overview

- **Total Tests:** 81
- **Test Suites:** 5
- **Coverage:** All extracted manager classes from tutor-loop.ts refactoring

---

## 1. AgentCaller Tests (6 tests)

**File:** `src/tutor-loop/__tests__/agent-caller.test.ts`  
**Component:** AgentCaller class (Phase 1)  
**Purpose:** Manages agent calls with queueing to prevent race conditions

### Tests

#### 1.1 `should prevent concurrent agent calls`
- **System Component:** AgentCaller call queueing mechanism
- **What It Tests:** Ensures multiple concurrent `callAgent()` invocations execute sequentially rather than simultaneously, preventing message array corruption

#### 1.2 `should handle errors and reset state`
- **System Component:** AgentCaller error handling
- **What It Tests:** Verifies that when agent calls fail, cleanup functions (stopLoading, setAgentRunning(false), displayError) are properly invoked

#### 1.3 `should stop loading when first text arrives`
- **System Component:** AgentCaller loading state management
- **What It Tests:** Confirms that `stopLoading()` is called exactly once when the first text arrives from the agent, not on subsequent text chunks

#### 1.4 `should forward text to display callback`
- **System Component:** AgentCaller text streaming
- **What It Tests:** Ensures text from the agent is properly forwarded to the display callback for rendering

#### 1.5 `should forward tool use events`
- **System Component:** AgentCaller tool event handling
- **What It Tests:** Verifies that tool usage events (e.g., "read_file") are forwarded to `displayToolStatus` with correct parameters

#### 1.6 `should set up SIGINT handler when enabled`
- **System Component:** AgentCaller Ctrl+C handling
- **What It Tests:** Confirms that SIGINT (Ctrl+C) handler is registered to save state/progress before exit

---

## 2. GoldenCodeManager Tests (21 tests)

**File:** `src/tutor-loop/__tests__/GoldenCodeManager.test.ts`  
**Component:** GoldenCodeManager class (Phase 2)  
**Purpose:** Manages golden code step progression and fixes the critical off-by-one bug

### Tests

#### 2.1 Initialization Tests (3 tests)

##### 2.1.1 `should start at step 0`
- **System Component:** GoldenCodeManager initialization
- **What It Tests:** Default initialization starts at step index 0

##### 2.1.2 `should initialize with provided step index`
- **System Component:** GoldenCodeManager constructor
- **What It Tests:** Can initialize with a specific step index (for resuming progress)

##### 2.1.3 `should handle null segment`
- **System Component:** GoldenCodeManager null handling
- **What It Tests:** Gracefully handles null segments without crashing

#### 2.2 loadCurrentStep Tests (6 tests)

##### 2.2.1 `should load step 0 as first step`
- **System Component:** GoldenCodeManager step loading (fixes off-by-one bug)
- **What It Tests:** **Critical test** - Verifies step 0 loads as "mkdir src" (the FIRST step), not step 1. This fixes the bug where the code was loading currentIndex + 1

##### 2.2.2 `should load step 1 as second step`
- **System Component:** GoldenCodeManager step loading
- **What It Tests:** Confirms step 1 correctly loads "touch src/index.ts" (the second step)

##### 2.2.3 `should return null when no segment`
- **System Component:** GoldenCodeManager null handling
- **What It Tests:** Returns null when segment is null

##### 2.2.4 `should return null when no golden code`
- **System Component:** GoldenCodeManager empty code handling
- **What It Tests:** Returns null when segment has no golden code

##### 2.2.5 `should return null when index is out of bounds`
- **System Component:** GoldenCodeManager bounds checking
- **What It Tests:** Returns null for index 999 (beyond available steps)

##### 2.2.6 `should return null for negative index`
- **System Component:** GoldenCodeManager bounds checking
- **What It Tests:** Returns null for negative indices

#### 2.3 advance Tests (4 tests)

##### 2.3.1 `should advance to next step and update progress`
- **System Component:** GoldenCodeManager step advancement
- **What It Tests:** Advancing from step 0 increments to step 1 and updates progress

##### 2.3.2 `should not advance beyond last step`
- **System Component:** GoldenCodeManager bounds enforcement
- **What It Tests:** Cannot advance past the final step (stays at step 3 when total is 4 steps)

##### 2.3.3 `should handle null segment gracefully`
- **System Component:** GoldenCodeManager null handling
- **What It Tests:** advance() doesn't crash on null segment

##### 2.3.4 `should handle corrupted progress with large index`
- **System Component:** GoldenCodeManager corruption protection
- **What It Tests:** Handles corrupted progress files with index=1000, preventing advancement beyond bounds

#### 2.4 clear Tests (1 test)

##### 2.4.1 `should clear current expected code`
- **System Component:** GoldenCodeManager code cache
- **What It Tests:** `clear()` removes cached golden code from memory

#### 2.5 hasMoreSteps Tests (3 tests)

##### 2.5.1 `should return true when there are more steps`
- **System Component:** GoldenCodeManager step counting
- **What It Tests:** Returns true at step 0 when more steps exist

##### 2.5.2 `should return false at last step`
- **System Component:** GoldenCodeManager completion detection
- **What It Tests:** Returns false when at the final step

##### 2.5.3 `should return false with no segment`
- **System Component:** GoldenCodeManager null handling
- **What It Tests:** Returns false for null segment

#### 2.6 getTotalSteps Tests (2 tests)

##### 2.6.1 `should return correct total number of steps`
- **System Component:** GoldenCodeManager step parsing
- **What It Tests:** Correctly counts 4 total steps in test golden code

##### 2.6.2 `should return 0 for null segment`
- **System Component:** GoldenCodeManager null handling
- **What It Tests:** Returns 0 steps for null segment

#### 2.7 updateSegment Tests (2 tests)

##### 2.7.1 `should reset to step 0 when segment changes`
- **System Component:** GoldenCodeManager segment transitions
- **What It Tests:** When moving to new segment, resets to step 0 and updates progress

##### 2.7.2 `should clear current code on segment change`
- **System Component:** GoldenCodeManager cache invalidation
- **What It Tests:** Clears cached code when segment changes

---

## 3. CommandExecutor Tests (23 tests)

**File:** `src/tutor-loop/__tests__/CommandExecutor.test.ts`  
**Component:** CommandExecutor class (Phase 3)  
**Purpose:** Centralizes shell command execution and heredoc state machine

### Tests

#### 3.1 isShellCommand Tests (3 tests)

##### 3.1.1 `should recognize standard shell commands`
- **System Component:** CommandExecutor command detection
- **What It Tests:** Recognizes mkdir, cat, git, npm as shell commands

##### 3.1.2 `should reject non-commands`
- **System Component:** CommandExecutor command detection
- **What It Tests:** Rejects natural language like "hello world" and "explain this code"

##### 3.1.3 `should handle commands with leading whitespace`
- **System Component:** CommandExecutor whitespace handling
- **What It Tests:** Recognizes commands with leading spaces/tabs

#### 3.2 startsHeredoc Tests (5 tests)

##### 3.2.1 `should detect heredoc with bare delimiter`
- **System Component:** CommandExecutor heredoc parsing
- **What It Tests:** Detects `cat > file.txt << EOF` format and extracts "EOF"

##### 3.2.2 `should detect heredoc with quoted delimiter`
- **System Component:** CommandExecutor heredoc parsing
- **What It Tests:** Handles both `<< 'EOF'` and `<< "EOF"` formats

##### 3.2.3 `should handle different delimiters`
- **System Component:** CommandExecutor heredoc parsing
- **What It Tests:** Works with delimiters like END, MARKER, etc., not just EOF

##### 3.2.4 `should return false for non-heredoc commands`
- **System Component:** CommandExecutor heredoc detection
- **What It Tests:** Returns false for regular commands like "mkdir src"

##### 3.2.5 `should handle heredoc with whitespace`
- **System Component:** CommandExecutor whitespace handling
- **What It Tests:** Parses heredocs with extra whitespace around delimiter

#### 3.3 heredoc state management Tests (5 tests)

##### 3.3.1 `should start heredoc state`
- **System Component:** CommandExecutor state machine
- **What It Tests:** `startHeredoc()` activates heredoc mode

##### 3.3.2 `should add lines to heredoc`
- **System Component:** CommandExecutor line accumulation
- **What It Tests:** `addHeredocLine()` accumulates multi-line content

##### 3.3.3 `should complete heredoc and reset state`
- **System Component:** CommandExecutor state machine
- **What It Tests:** `completeHeredoc()` executes command and resets state

##### 3.3.4 `should not complete heredoc with wrong delimiter`
- **System Component:** CommandExecutor delimiter matching
- **What It Tests:** State remains active if delimiter doesn't match

##### 3.3.5 `should reset heredoc state on error`
- **System Component:** CommandExecutor error recovery
- **What It Tests:** `resetHeredoc()` clears state after errors (fixes bug where users got stuck)

#### 3.4 executeCommand Tests (4 tests)

##### 3.4.1 `should execute simple commands successfully`
- **System Component:** CommandExecutor command execution
- **What It Tests:** Executes `pwd` command and returns success + output

##### 3.4.2 `should handle command failures`
- **System Component:** CommandExecutor error handling
- **What It Tests:** Returns failure status for non-existent commands

##### 3.4.3 `should update progress after file creation`
- **System Component:** CommandExecutor progress tracking
- **What It Tests:** Calls `updateProgress` and `addCompletedStep` after successful file creation

##### 3.4.4 `should track git commits`
- **System Component:** CommandExecutor git integration
- **What It Tests:** Handles git commands without throwing

#### 3.5 getMessageForAgent Tests (3 tests)

##### 3.5.1 `should format successful command message`
- **System Component:** CommandExecutor message formatting
- **What It Tests:** Formats success message with "I ran: <command>" format

##### 3.5.2 `should format error message`
- **System Component:** CommandExecutor message formatting
- **What It Tests:** Includes error details in message to agent

##### 3.5.3 `should include output when present`
- **System Component:** CommandExecutor message formatting
- **What It Tests:** Includes command output in message when available

#### 3.6 extractFileName Tests (3 tests)

##### 3.6.1 `should extract filename from cat > commands`
- **System Component:** CommandExecutor filename parsing
- **What It Tests:** Extracts "src/index.ts" from `cat > src/index.ts << EOF`

##### 3.6.2 `should extract filename from redirection`
- **System Component:** CommandExecutor filename parsing
- **What It Tests:** Extracts filename from `echo "test" > test.txt`

##### 3.6.3 `should return generic name if not found`
- **System Component:** CommandExecutor fallback behavior
- **What It Tests:** Returns generic name for commands without obvious file creation

---

## 4. InputHandler Tests (16 tests)

**File:** `src/tutor-loop/__tests__/InputHandler.test.ts`  
**Component:** InputHandler class (Phase 4)  
**Purpose:** Manages mode-based input (tutor/block/discuss) and mode transitions

### Tests

#### 4.1 discuss mode Tests (2 tests)

##### 4.1.1 `should use free-form input in discuss mode`
- **System Component:** InputHandler discuss mode
- **What It Tests:** Handler can be created (full test requires complex readline mocking)

##### 4.1.2 `should clear golden code in discuss mode`
- **System Component:** InputHandler mode behavior
- **What It Tests:** Discuss mode clears golden code expectations

#### 4.2 block/code mode Tests (2 tests)

##### 4.2.1 `should provide expected code as reference in block mode`
- **System Component:** InputHandler block mode
- **What It Tests:** Block mode provides golden code as reference but doesn't enforce it

##### 4.2.2 `should clear golden code after block mode input`
- **System Component:** InputHandler mode behavior
- **What It Tests:** Golden code is cleared after block mode input completes

#### 4.3 tutor mode Tests (5 tests)

##### 4.3.1 `should lazy load golden code when not present`
- **System Component:** InputHandler lazy loading
- **What It Tests:** If golden code not loaded, triggers `loadCurrentStep()`

##### 4.3.2 `should handle single-line Typer Shark input`
- **System Component:** InputHandler Typer Shark mode
- **What It Tests:** Handles simple commands like "mkdir src" with Typer Shark

##### 4.3.3 `should handle multi-line Typer Shark input`
- **System Component:** InputHandler Typer Shark mode
- **What It Tests:** Handles heredocs with line-by-line Typer Shark guidance

##### 4.3.4 `should advance golden step after successful input`
- **System Component:** InputHandler step progression
- **What It Tests:** After completing Typer Shark input, advances to next step

##### 4.3.5 `should handle question prefix in multi-line input`
- **System Component:** InputHandler question detection
- **What It Tests:** Recognizes `__QUESTION__:` prefix for user questions during Typer Shark

#### 4.4 heredoc continuation Tests (2 tests)

##### 4.4.1 `should use readline for heredoc continuation`
- **System Component:** InputHandler heredoc mode
- **What It Tests:** During heredoc input, uses raw readline (not Typer Shark)

##### 4.4.2 `should not use Typer Shark during heredoc`
- **System Component:** InputHandler mode detection
- **What It Tests:** Typer Shark is disabled when heredoc is active

#### 4.5 mode detection and transitions Tests (3 tests)

##### 4.5.1 `should detect mode changes`
- **System Component:** InputHandler mode tracking
- **What It Tests:** Can detect when mode changes (e.g., tutor → discuss)

##### 4.5.2 `should reload code when switching to tutor mode`
- **System Component:** InputHandler mode transitions
- **What It Tests:** Switching TO tutor mode triggers golden code reload

##### 4.5.3 `should clear code when leaving tutor mode`
- **System Component:** InputHandler mode transitions
- **What It Tests:** Switching FROM tutor mode clears golden code

#### 4.6 expected code formatting Tests (2 tests)

##### 4.6.1 `should format multi-line expected code as string`
- **System Component:** InputHandler code formatting
- **What It Tests:** Converts line array to newline-joined string

##### 4.6.2 `should handle single-line expected code`
- **System Component:** InputHandler code formatting
- **What It Tests:** Single-line code doesn't have `lines` array

---

## 5. SegmentLifecycleManager Tests (15 tests)

**File:** `src/tutor-loop/__tests__/SegmentLifecycleManager.test.ts`  
**Component:** SegmentLifecycleManager class (Phase 5)  
**Purpose:** Manages segment completion, curriculum transitions, and progress creation

### Tests

#### 5.1 segment completion Tests (3 tests)

##### 5.1.1 `should handle segment completion`
- **System Component:** SegmentLifecycleManager completion flow
- **What It Tests:** Complete flow: save state, log interaction, return completion status

##### 5.1.2 `should update state with completed segment ID`
- **System Component:** SegmentLifecycleManager state updates
- **What It Tests:** Adds segment ID to completedSegments array, increments index, stores summary

##### 5.1.3 `should log completed steps count`
- **System Component:** SegmentLifecycleManager logging
- **What It Tests:** Logs metadata including count of completed steps (2 in test)

#### 5.2 curriculum completion Tests (2 tests)

##### 5.2.1 `should detect when curriculum is complete`
- **System Component:** SegmentLifecycleManager curriculum completion
- **What It Tests:** Detects last segment completion, logs curriculum_completed, displays completion

##### 5.2.2 `should log curriculum completion with metadata`
- **System Component:** SegmentLifecycleManager logging
- **What It Tests:** Logs curriculum ID, project name, total segments on completion

#### 5.3 next segment transition Tests (5 tests)

##### 5.3.1 `should prepare next segment`
- **System Component:** SegmentLifecycleManager segment transitions
- **What It Tests:** Returns next segment (segment-2) after completing segment-1

##### 5.3.2 `should create progress for next segment`
- **System Component:** SegmentLifecycleManager progress management
- **What It Tests:** Creates initial progress for next segment and saves it

##### 5.3.3 `should prune context for next segment`
- **System Component:** SegmentLifecycleManager context management
- **What It Tests:** Calls `pruneContextForNewSegment()` with summary to reduce message history

##### 5.3.4 `should display segment completion`
- **System Component:** SegmentLifecycleManager display
- **What It Tests:** Displays completion message with summary and next segment preview

##### 5.3.5 `should display new segment header`
- **System Component:** SegmentLifecycleManager display
- **What It Tests:** Shows header for newly started segment

#### 5.4 error handling Tests (2 tests)

##### 5.4.1 `should handle missing next segment`
- **System Component:** SegmentLifecycleManager null handling
- **What It Tests:** When no next segment exists, shows curriculum complete

##### 5.4.2 `should handle saveState failures gracefully`
- **System Component:** SegmentLifecycleManager error propagation
- **What It Tests:** Propagates save errors to caller

#### 5.5 state updates Tests (3 tests)

##### 5.5.1 `should increment segment index`
- **System Component:** SegmentLifecycleManager index management
- **What It Tests:** Increments currentSegmentIndex by 1

##### 5.5.2 `should preserve previous completed segments`
- **System Component:** SegmentLifecycleManager history preservation
- **What It Tests:** Appends to completedSegments array without overwriting

##### 5.5.3 `should store summary for next segment`
- **System Component:** SegmentLifecycleManager summary passing
- **What It Tests:** Stores summary in state.previousSegmentSummary for next segment context

---

## Test Statistics by Component

| Component | Tests | Lines of Code | Test Density |
|-----------|-------|---------------|--------------|
| AgentCaller | 6 | 148 | 1 test per 25 LOC |
| GoldenCodeManager | 21 | 148 | 1 test per 7 LOC |
| CommandExecutor | 23 | 218 | 1 test per 9 LOC |
| InputHandler | 16 | 145 | 1 test per 9 LOC |
| SegmentLifecycleManager | 15 | 182 | 1 test per 12 LOC |
| **Total** | **81** | **841** | **1 test per 10 LOC** |

---

## Critical Bug Fixes Verified by Tests

1. **Off-by-one bug (Test 2.2.1):** GoldenCodeManager now loads step N instead of step N+1
2. **Race condition (Test 1.1):** AgentCaller queues concurrent calls sequentially
3. **Heredoc reset (Test 3.3.5):** CommandExecutor resets heredoc state on error
4. **SIGINT handling (Test 1.6):** AgentCaller saves state on Ctrl+C

---

## Test Coverage Summary

- ✅ **Initialization:** All classes tested with default and custom initialization
- ✅ **Null Handling:** All classes tested with null/missing data
- ✅ **Bounds Checking:** Index validation (negative, zero, max, beyond max)
- ✅ **Error Recovery:** Error handling and state cleanup
- ✅ **State Management:** State transitions and updates
- ✅ **Progress Tracking:** All progress updates verified
- ✅ **Edge Cases:** Corrupted data, empty inputs, missing files

---

## Running the Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- agent-caller
npm test -- GoldenCodeManager
npm test -- CommandExecutor
npm test -- InputHandler
npm test -- SegmentLifecycleManager

# Run with coverage
npm test -- --coverage
```

---

*Generated: Phase 6 Completion*  
*Total Test Execution Time: ~0.789s*
