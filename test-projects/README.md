# Test Projects

This folder contains test curriculum files for rapid testing of tutor features.

## Quick Completion Test

**File:** `curriculum-quick-completion.json`

A minimal curriculum with a single BUILD segment that requires only creating a folder and typing "hello world" into a file.

### Usage

```bash
claude-tutor start --curriculum test-projects/curriculum-quick-completion.json
```

### Expected Workflow

1. CLI starts with the quick completion curriculum
2. Project directory auto-created in `~/.claude-tutor/projects/quick-completion-test-[id]/`
3. Tutor asks you to create `hello-folder/hello.txt` with "hello world" content
4. You create the folder and file:
   ```bash
   mkdir hello-folder
   echo "hello world" > hello-folder/hello.txt
   ```
5. You commit the changes:
   ```bash
   git add .
   git commit -m "Add hello world file"
   ```
6. Segment completes rapidly for testing features like session logging, completion tracking, etc.

### Purpose

This test curriculum allows rapid iteration on features related to:

- Segment completion detection
- Session logging and analytics
- Progress tracking
- Curriculum completion workflow
- Resume functionality
