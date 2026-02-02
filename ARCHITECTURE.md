# Claude Code Tutor - System Architecture

## System Overview

Claude Code Tutor is an interactive command-line tutoring system that teaches software engineering concepts through hands-on TypeScript coding. It functions as a personalized coding instructor powered by Claude AI, providing adaptive learning experiences through multiple interaction modes and dynamic curriculum generation.

The system creates personalized curricula based on user project ideas and guides learners through building real applications step-by-step, combining AI-powered instruction with practical coding exercises.

## Core Components

### 1. CLI Interface & Entry Point

**Modules:** `index.ts`, `auth.ts`, `preflight.ts`, `update.ts`

**Primary Responsibilities:**

- Command-line parsing and routing (`start`, `resume`, `login` commands)
- User authentication and API credential management
- Auto-update mechanism for keeping the tutor current
- Environment setup and preflight checks
- Project directory creation and validation

**Key Features:**

- Handles initial user authentication with backend API
- Validates environment prerequisites before starting sessions
- Manages global configuration and user credentials
- Provides automatic updates to ensure latest features

### 2. User Interaction System

**Modules:** `input.ts`, `display.ts`, `mode.ts`, `questions.ts`

**Primary Responsibilities:**

- Multi-modal input handling including Typer Shark character-by-character tracking
- Terminal display management with rich UI rendering
- Mode switching between Tutor, Discuss, and Block modes
- Interactive questionnaires for learner profiling
- Real-time typing feedback and visual guidance

**Key Features:**

- **Typer Shark Mode**: Character-by-character guided typing for muscle memory
- **Block Mode**: Free-form coding with reference code display
- **Discuss Mode**: Natural language Q&A for conceptual understanding
- Rich terminal UI with colors, progress bars, and mode indicators
- Interactive wizards for setup and profiling

### 3. AI Agent & Curriculum System

**Modules:** `agent.ts`, `curriculum.ts`, `system-prompt.ts`

**Primary Responsibilities:**

- Claude AI integration with streaming responses and tool use
- Dynamic curriculum generation based on learner profiles
- Segment creation with Build and Refactor types
- Context management and conversation history
- Personalized tutoring prompts and system prompt construction

**Key Features:**

- Streaming AI responses with real-time text and tool callbacks
- Tool-enabled AI agent for syntax checking, code review, and git operations
- Dynamic curriculum adaptation based on user progress and preferences
- Context-aware prompt engineering for effective tutoring
- Segment-based learning progression with checkpoints

### 4. Learning Execution Engine

**Modules:** `tutor-loop.ts`, `golden-code.ts`, `tools.ts`

**Primary Responsibilities:**

- Main tutoring conversation loop orchestrating all interactions
- Golden code progression tracking through step-by-step instructions
- Shell command execution and validation
- Code verification tools for syntax and quality checking
- Segment completion logic and progression management

**Key Features:**

- Central event loop managing user input, AI responses, and system actions
- Golden code parser for structured coding instructions
- Tool system enabling Claude to perform syntax checks, code reviews, and git operations
- Progress tracking within individual segments
- Mode-aware interaction handling

### 5. State Management & Persistence

**Modules:** `storage.ts`, `types.ts`, `logging.ts`

**Primary Responsibilities:**

- Project state persistence including progress, segments, and curriculum
- Configuration management for API keys and user settings
- Progress tracking within segments and across the curriculum
- Interaction logging and analytics
- Data validation using Zod schemas for type safety

**Key Features:**

- File-based JSON persistence for simplicity and portability
- Global state management in `~/.claude-tutor/`
- Project-specific progress tracking in project directories
- Comprehensive type system with runtime validation
- Session logging for analytics and debugging

### 6. External Integrations

**Modules:** `git.ts`, `utils.ts`, `important.ts`

**Primary Responsibilities:**

- Git repository management and version control operations
- File system operations and environment integration
- Utility functions for cross-cutting concerns
- System tool integration (TypeScript compiler, Node.js)

**Key Features:**

- Automated git repository initialization and management
- Integration with TypeScript compiler for syntax validation
- Node.js execution for JavaScript code validation
- Cross-platform file system operations
- Environment detection and adaptation

## System Architecture Patterns

### Event-Driven Streaming Architecture

- Claude API streaming with real-time text and tool use callbacks
- Asynchronous event handling for responsive user interaction
- Non-blocking UI updates during AI response generation

### State Machine Pattern

- Mode management with clear state transitions (Tutor ↔ Discuss ↔ Block)
- Progress tracking through curriculum segments with checkpoints
- Resume capability from exact previous state

### Command Pattern

- Tool system where Claude can invoke specific actions (syntax check, git operations)
- Shell command execution with proper error handling and validation
- Extensible tool interface for future capabilities

### Strategy Pattern

- Different input handlers based on current interaction mode
- Multiple display strategies for various content types
- Adaptive AI prompting based on learning context

## Data Flow Architecture

### Primary Data Flows

1. **Initialization Flow**

   ```
   CLI Entry → Authentication → Preflight Checks → State Initialization
   ```

2. **Curriculum Generation Flow**

   ```
   User Questions → Profile Creation → AI Curriculum Generation → Segment Storage
   ```

3. **Learning Loop Flow**

   ```
   User Input → Learning Engine → AI Processing → State Update → Display Update
   ```

4. **Code Execution Flow**
   ```
   User Code → Tool Validation → External Integration → Result Display
   ```

### Central State Hub

State Management serves as the central data hub, with all components reading and writing state through its APIs. This ensures consistency and enables seamless session resumption.

### Component Orchestration

The Learning Execution Engine coordinates between User Interaction, AI Agent, and External Integrations, managing the overall learning workflow while maintaining separation of concerns.

## System Lifecycle

### Phase 1: Initialization

- **Environment Setup**: Validate prerequisites and setup project directory
- **Authentication**: Verify user credentials and backend connectivity
- **Project Creation**: Initialize git repository and project structure
- **State Preparation**: Create initial state files and configuration

### Phase 2: Curriculum Generation

- **Learner Profiling**: Collect user background through AI-driven questions
- **Project Definition**: Capture user's project idea and learning goals
- **Curriculum Creation**: Generate personalized learning segments using Claude
- **Segment Structuring**: Organize content into Build and Refactor segments

### Phase 3: Active Learning Loop

- **Segment Progression**: Move through curriculum segments sequentially
- **Multi-Modal Interaction**: Support Typer Shark, free discussion, and code blocks
- **Real-Time Feedback**: Provide immediate validation and AI tutoring responses
- **Progress Persistence**: Continuously save progress and state for resumption

### Phase 4: Completion & Advancement

- **Code Verification**: Validate syntax and quality through automated tools
- **Git Integration**: Require commits for segment completion and version control
- **Progression Logic**: Automatically advance to next segment upon completion
- **Curriculum Completion**: Celebrate achievements and provide next steps

## Design Decisions

### File-Based State Management

**Decision**: Use JSON files for persistence instead of a database
**Rationale**: Simplicity, portability, and easy debugging without external dependencies

### Three-Mode Learning System

**Decision**: Provide Tutor (guided), Block (free-form), and Discuss (Q&A) modes
**Rationale**: Accommodate different learning styles and provide flexibility in interaction

### AI-Generated Dynamic Curriculum

**Decision**: Generate curricula dynamically rather than using static content
**Rationale**: Personalization, adaptability, and ability to stay current with technologies

### Tool-Enabled AI Agent

**Decision**: Provide Claude with specific tools for code validation and system operations
**Rationale**: Enable practical verification and maintain code quality standards

### Terminal-Based Interface

**Decision**: CLI rather than web or desktop GUI
**Rationale**: Developer-friendly environment, lower complexity, and better integration with development tools

## External Dependencies

### AI Services

- **Anthropic Claude API**: Primary AI agent for tutoring and curriculum generation
- **Backend API**: User authentication, personalized questions, and analytics

### Development Tools

- **TypeScript Compiler**: Code syntax validation and type checking
- **Git**: Version control and project management
- **Node.js**: JavaScript execution and validation

### System Integration

- **File System**: Project directory management and state persistence
- **Terminal Environment**: User interface and command execution
- **Network**: API communications and updates

## Security Considerations

### API Key Management

- Secure storage of Claude API credentials
- Backend authentication for user sessions
- Environment-based configuration for sensitive data

### Code Execution

- Sandboxed execution of user code
- Validation before executing shell commands
- Git repository isolation per project

### Data Privacy

- Local storage of user progress and state
- Minimal data transmission to backend services
- User control over data persistence and sharing

## Extensibility

### Tool System

- Modular tool architecture allows easy addition of new capabilities
- Claude can be given new tools for expanded functionality
- External integrations can be added without core changes

### Mode System

- New interaction modes can be added alongside existing ones
- Mode-specific behaviors are encapsulated and extensible
- Display and input handling adapt automatically to new modes

### Curriculum System

- AI-generated content adapts to new technologies and frameworks
- Segment types can be expanded beyond Build/Refactor
- Learning patterns can be customized per user or project type
