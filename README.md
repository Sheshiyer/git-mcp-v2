# Git MCP Server

A Model Context Protocol (MCP) server that provides enhanced Git operations through a standardized interface. This server integrates with the MCP ecosystem to provide Git functionality to AI assistants.

<a href="https://glama.ai/mcp/servers/46aozzlyhx"><img width="380" height="200" src="https://glama.ai/mcp/servers/46aozzlyhx/badge" alt="Git Server MCP server" /></a>

## Features

- **Core Git Operations**: init, clone, status, add, commit, push, pull
- **Branch Management**: list, create, delete, checkout
- **Tag Operations**: list, create, delete
- **Remote Management**: list, add, remove
- **Stash Operations**: list, save, pop
- **Bulk Actions**: Execute multiple Git operations in sequence
- **GitHub Integration**: Built-in GitHub support via Personal Access Token
- **Path Resolution**: Smart path handling with optional default path configuration
- **Error Handling**: Comprehensive error handling with custom error types
- **Repository Caching**: Efficient repository state management
- **Performance Monitoring**: Built-in performance tracking

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/git-mcp-v2.git
cd git-mcp-v2
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

Add to your MCP settings file:

```json
{
  "mcpServers": {
    "git-v2": {
      "command": "node",
      "args": ["path/to/git-mcp-v2/build/index.js"],
      "env": {
        "GIT_DEFAULT_PATH": "/path/to/default/git/directory",
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-github-pat"
      }
    }
  }
}
```

## Environment Variables

- `GIT_DEFAULT_PATH`: (Optional) Default path for Git operations
- `GITHUB_PERSONAL_ACCESS_TOKEN`: (Optional) GitHub Personal Access Token for GitHub operations

## Available Tools

### Basic Operations
- `init`: Initialize a new Git repository
- `clone`: Clone a repository
- `status`: Get repository status
- `add`: Stage files
- `commit`: Create a commit
- `push`: Push commits to remote
- `pull`: Pull changes from remote

### Branch Operations
- `branch_list`: List all branches
- `branch_create`: Create a new branch
- `branch_delete`: Delete a branch
- `checkout`: Switch branches or restore working tree files

### Tag Operations
- `tag_list`: List tags
- `tag_create`: Create a tag
- `tag_delete`: Delete a tag

### Remote Operations
- `remote_list`: List remotes
- `remote_add`: Add a remote
- `remote_remove`: Remove a remote

### Stash Operations
- `stash_list`: List stashes
- `stash_save`: Save changes to stash
- `stash_pop`: Apply and remove a stash

### Bulk Operations
- `bulk_action`: Execute multiple Git operations in sequence

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint

# Format code
npm run format
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
