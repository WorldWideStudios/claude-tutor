# Claude Code Tutor - System Diagrams

## System Architecture Overview

```mermaid
graph TB
    %% User Entry Points
    CLI[CLI Interface & Entry Point<br/>index.ts, auth.ts, preflight.ts, update.ts]

    %% Core System Components
    UI[User Interaction System<br/>input.ts, display.ts, mode.ts, questions.ts]
    AI[AI Agent & Curriculum System<br/>agent.ts, curriculum.ts, system-prompt.ts]
    ENGINE[Learning Execution Engine<br/>tutor-loop.ts, golden-code.ts, tools.ts]
    STATE[State Management & Persistence<br/>storage.ts, types.ts, logging.ts]
    EXT[External Integrations<br/>git.ts, utils.ts, important.ts]

    %% External Services
    CLAUDE[Claude AI API<br/>Anthropic]
    BACKEND[Backend API<br/>Authentication & Analytics]
    TOOLS[System Tools<br/>TypeScript, Git, Node.js]

    %% User flows
    USER([User])

    %% Main relationships
    USER --> CLI
    CLI --> STATE
    CLI --> UI
    UI --> ENGINE
    ENGINE --> AI
    ENGINE --> STATE
    ENGINE --> EXT
    AI --> CLAUDE
    AI --> STATE
    CLI --> BACKEND
    EXT --> TOOLS
    STATE --> EXT

    %% Feedback loops
    AI --> UI
    ENGINE --> UI
    STATE --> UI
    EXT --> ENGINE

    %% Styling
    classDef component fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef external fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef user fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px

    class CLI,UI,AI,ENGINE,STATE,EXT component
    class CLAUDE,BACKEND,TOOLS external
    class USER user
```

## Data Flow Architecture

```mermaid
flowchart TD
    %% Initialization Phase
    START([User Starts Application]) --> AUTH{Authentication<br/>Required?}
    AUTH -->|Yes| LOGIN[Login Process<br/>Backend API]
    AUTH -->|No| PREFLIGHT[Preflight Checks<br/>Environment Validation]
    LOGIN --> PREFLIGHT

    %% Setup Phase
    PREFLIGHT --> PROJECT{Existing<br/>Project?}
    PROJECT -->|No| QUESTIONS[Interactive Questionnaire<br/>User Profiling]
    PROJECT -->|Yes| LOAD[Load Project State<br/>Resume Progress]

    QUESTIONS --> CURRICULUM[AI Curriculum Generation<br/>Claude API]
    CURRICULUM --> SEGMENTS[Create Learning Segments<br/>Build & Refactor Types]
    SEGMENTS --> SAVE_STATE[Save Initial State<br/>File-based Storage]

    LOAD --> RESTORE[Restore Session State<br/>Progress & Mode]
    SAVE_STATE --> TUTOR_LOOP
    RESTORE --> TUTOR_LOOP

    %% Main Learning Loop
    TUTOR_LOOP[Main Tutor Loop<br/>Conversation Engine]

    TUTOR_LOOP --> INPUT_HANDLER{Input Type}

    %% Input Processing Paths
    INPUT_HANDLER -->|Command| CMD_PROCESS[Process Command<br/>Mode Switch, Help, etc.]
    INPUT_HANDLER -->|Code/Text| MODE_HANDLER{Current Mode}

    MODE_HANDLER -->|Tutor Mode| TYPER[Typer Shark<br/>Character-by-Character]
    MODE_HANDLER -->|Block Mode| FREEFORM[Free-form Input<br/>Code Blocks]
    MODE_HANDLER -->|Discuss Mode| QUESTION[Natural Language<br/>Q&A Processing]

    %% AI Processing
    TYPER --> AI_PROCESS[AI Agent Processing<br/>Claude API + Tools]
    FREEFORM --> AI_PROCESS
    QUESTION --> AI_PROCESS
    CMD_PROCESS --> AI_PROCESS

    AI_PROCESS --> TOOL_USE{Tool Use<br/>Required?}
    TOOL_USE -->|Yes| EXECUTE_TOOLS[Execute Tools<br/>Syntax Check, Git, etc.]
    TOOL_USE -->|No| AI_RESPONSE[Generate AI Response<br/>Streaming Text]

    EXECUTE_TOOLS --> TOOL_RESULTS[Tool Results<br/>Success/Error Feedback]
    TOOL_RESULTS --> AI_RESPONSE

    %% Output and State Management
    AI_RESPONSE --> DISPLAY_UPDATE[Update Display<br/>Rich Terminal UI]
    DISPLAY_UPDATE --> STATE_UPDATE[Update State<br/>Progress, Mode, Context]

    STATE_UPDATE --> COMPLETION{Segment<br/>Complete?}
    COMPLETION -->|No| TUTOR_LOOP
    COMPLETION -->|Yes| GIT_COMMIT[Require Git Commit<br/>Version Control]

    GIT_COMMIT --> NEXT_SEGMENT{More<br/>Segments?}
    NEXT_SEGMENT -->|Yes| LOAD_NEXT[Load Next Segment<br/>Progress Forward]
    NEXT_SEGMENT -->|No| COMPLETE[Curriculum Complete<br/>Celebration & Next Steps]

    LOAD_NEXT --> TUTOR_LOOP
    COMPLETE --> END([Session End])

    %% Styling
    classDef initPhase fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef learningPhase fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef aiPhase fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef decisionPhase fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class START,AUTH,LOGIN,PREFLIGHT initPhase
    class TUTOR_LOOP,INPUT_HANDLER,MODE_HANDLER,TYPER,FREEFORM,QUESTION learningPhase
    class AI_PROCESS,TOOL_USE,EXECUTE_TOOLS,AI_RESPONSE aiPhase
    class PROJECT,COMPLETION,NEXT_SEGMENT decisionPhase
```

## User Interaction Patterns

```mermaid
stateDiagram-v2
    [*] --> Initialization

    state Initialization {
        [*] --> Authentication
        Authentication --> EnvironmentSetup
        EnvironmentSetup --> ProjectDetection
        ProjectDetection --> UserProfiling: New Project
        ProjectDetection --> StateRestoration: Existing Project
        UserProfiling --> CurriculumGeneration
        CurriculumGeneration --> ReadyToLearn
        StateRestoration --> ReadyToLearn
    }

    Initialization --> LearningSession: Ready

    state LearningSession {
        [*] --> TutorMode

        state TutorMode {
            [*] --> TyperShark
            TyperShark --> CharacterValidation
            CharacterValidation --> ProgressUpdate
            ProgressUpdate --> TyperShark: Continue
            ProgressUpdate --> StepComplete: Step Done
        }

        state BlockMode {
            [*] --> FreeformInput
            FreeformInput --> CodeValidation
            CodeValidation --> BlockComplete
        }

        state DiscussMode {
            [*] --> QuestionInput
            QuestionInput --> AIResponse
            AIResponse --> FollowUp
            FollowUp --> QuestionInput: More Questions
            FollowUp --> DiscussComplete: Done
        }

        TutorMode --> BlockMode: /block
        TutorMode --> DiscussMode: /discuss
        BlockMode --> TutorMode: /tutor
        BlockMode --> DiscussMode: /discuss
        DiscussMode --> TutorMode: /tutor
        DiscussMode --> BlockMode: /block

        StepComplete --> SegmentValidation
        BlockComplete --> SegmentValidation
        DiscussComplete --> SegmentValidation

        SegmentValidation --> GitCommit: Segment Done
        SegmentValidation --> TutorMode: Continue Segment
    }

    GitCommit --> NextSegment: More Segments
    GitCommit --> Completion: Curriculum Done
    NextSegment --> LearningSession
    Completion --> [*]
```

## Component Interaction Detail

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI Interface
    participant UI as User Interaction
    participant Engine as Learning Engine
    participant AI as AI Agent
    participant State as State Management
    participant Tools as External Tools

    %% Initialization
    User->>CLI: claude-tutor start
    CLI->>State: Load/Create Project
    CLI->>UI: Initialize Display
    CLI->>Engine: Start Tutor Loop

    %% Learning Session
    loop Learning Session
        Engine->>UI: Request Input
        UI->>User: Display Prompt
        User->>UI: Provide Input
        UI->>Engine: Process Input

        alt Code Input
            Engine->>AI: Send to Claude
            AI->>Tools: Syntax Check
            Tools-->>AI: Validation Result
            AI-->>Engine: Response + Tools
        else Discussion
            Engine->>AI: Send Question
            AI-->>Engine: AI Response
        else Command
            Engine->>Engine: Process Command
        end

        Engine->>State: Update Progress
        Engine->>UI: Update Display
        UI->>User: Show Response

        opt Segment Complete
            Engine->>Tools: Git Commit
            Tools-->>Engine: Commit Result
            Engine->>State: Mark Segment Done
            Engine->>State: Load Next Segment
        end
    end

    %% Completion
    Engine->>UI: Show Completion
    UI->>User: Celebrate Success
```

## System State Transitions

```mermaid
graph LR
    %% Application States
    OFFLINE[Application Offline] --> STARTING[Starting Up]
    STARTING --> AUTHENTICATING[Authenticating]
    AUTHENTICATING --> LOADING[Loading Project]
    LOADING --> PROFILING[User Profiling]
    LOADING --> READY[Ready to Learn]
    PROFILING --> GENERATING[Generating Curriculum]
    GENERATING --> READY

    %% Learning States
    READY --> ACTIVE[Active Learning]
    ACTIVE --> PROCESSING[Processing Input]
    PROCESSING --> RESPONDING[AI Responding]
    RESPONDING --> VALIDATING[Validating Code]
    VALIDATING --> ACTIVE
    VALIDATING --> COMPLETING[Completing Segment]
    COMPLETING --> COMMITTING[Git Commit]
    COMMITTING --> ACTIVE
    COMMITTING --> FINISHED[Curriculum Complete]

    %% Error and Recovery
    AUTHENTICATING --> ERROR[Error State]
    LOADING --> ERROR
    GENERATING --> ERROR
    PROCESSING --> ERROR
    RESPONDING --> ERROR
    VALIDATING --> ERROR
    ERROR --> READY
    ERROR --> OFFLINE

    %% Mode Transitions within Active Learning
    ACTIVE --> TUTOR_MODE[Tutor Mode]
    ACTIVE --> BLOCK_MODE[Block Mode]
    ACTIVE --> DISCUSS_MODE[Discuss Mode]
    TUTOR_MODE --> ACTIVE
    BLOCK_MODE --> ACTIVE
    DISCUSS_MODE --> ACTIVE

    FINISHED --> OFFLINE

    %% Styling
    classDef initState fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef activeState fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef errorState fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef modeState fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class OFFLINE,STARTING,AUTHENTICATING,LOADING,PROFILING,GENERATING,READY initState
    class ACTIVE,PROCESSING,RESPONDING,VALIDATING,COMPLETING,COMMITTING,FINISHED activeState
    class ERROR errorState
    class TUTOR_MODE,BLOCK_MODE,DISCUSS_MODE modeState
```

## Technology Integration Map

```mermaid
mindmap
  root((Claude Code Tutor))
    AI Services
      Claude API
        Streaming Responses
        Tool Use Capability
        Context Management
      Backend API
        User Authentication
        Analytics
        Personalized Questions
    Development Tools
      TypeScript Compiler
        Syntax Validation
        Type Checking
        Error Reporting
      Git
        Repository Management
        Commit Tracking
        Version Control
      Node.js
        Code Execution
        Package Management
        Environment Integration
    User Interface
      Terminal Display
        Rich Text Formatting
        Progress Indicators
        Mode Visualization
      Input Handling
        Character-by-Character
        Multi-line Input
        Command Processing
      Interactive Elements
        Questionnaires
        Mode Switching
        Real-time Feedback
    Data Management
      File System
        JSON Persistence
        Project Storage
        Configuration Management
      State Tracking
        Progress Monitoring
        Session Restoration
        Context Preservation
      Type Safety
        Zod Validation
        Runtime Checking
        Schema Evolution
```
