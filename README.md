# Claude Tutor

A tool for learning to code via claude code sdk

## Dependencies

- Backend - you can find the code for the backend in the `claude-tutor-api` repo, by default it will utilize our backend hosted on heroku

## Setup

- `npm i`
- for `claude-tutor` command
  - `npm run build`
  - `npm link`
- for development
  - `npm run dev`
## Usage

### Command Line Options

- `-d, --dir <directory>` - Project directory (auto-creates if not specified)
- `-t, --token <apiKey>` - API token for authentication
- `--curriculum <path>` - Path to curriculum JSON file (skips curriculum generation)
- `--debug` - Enable debug logging (shows verbose internal logs)

### Debug Mode

Enable debug mode to see verbose internal logs such as step loading, golden code manager operations, and segment lifecycle events:

```bash
# Using the CLI flag
claude-tutor --debug

# Using environment variable
DEBUG=true claude-tutor

# In .env file
DEBUG=true
```

Debug logs include:
- `[GoldenCodeManager]` - Step loading, advancing, and clearing operations
- `[TutorLoop]` - Resume and segment state operations
- `[SegmentLifecycleManager]` - Segment completion and transitions
- Progress save operations during interrupts (SIGINT)

Without debug mode, only user-facing messages and errors are displayed.

## License

This project is licensed under the [GNU AGPL v3](LICENSE).