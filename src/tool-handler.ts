import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { ErrorHandler } from './errors/error-handler.js';
import { GitMcpError } from './errors/error-types.js';
import { GitOperations } from './git-operations.js';
import {
  BasePathOptions,
  GitServerConfig,
  GitToolName,
  isAddOptions,
  isBranchOptions,
  isBulkActionOptions,
  isCheckoutOptions,
  isCloneOptions,
  isCommitOptions,
  isInitOptions,
  isPathOnly,
  isPushPullOptions,
  isRemoteOptions,
  isStashOptions,
  isTagOptions
} from './types.js';
import { logger } from './utils/logger.js';

const PATH_DESCRIPTION = `MUST be an absolute path (e.g., /Users/username/projects/my-repo) if provided, otherwise the current working directory will be used`;
const FILE_PATH_DESCRIPTION = `MUST be an absolute path (e.g., /Users/username/projects/my-repo/src/file.js)`;

export class ToolHandler {
  private static readonly TOOL_PREFIX = 'git_mcp_server';
  private enabledTools: Set<string> | null = null;
  private includedTools: Set<string> | null = null;
  private excludedTools: Set<string> = new Set();

  constructor(private server: Server) {
    this.setupHandlers();
  }

  /**
   * Configure the tool handler
   * @param config Server configuration
   */
  public configure(config: GitServerConfig): void {
    // First check for include/exclude style configuration
    if (config.includeTools || config.excludeTools) {
      // Set up included tools if specified
      if (config.includeTools && config.includeTools.length > 0) {
        this.includedTools = new Set(config.includeTools.map(tool => tool));
        logger.info('ToolHandler', 'Configured with specific included tools', JSON.stringify([...this.includedTools]));
      } else {
        // If not specified, enable all tools by default
        this.includedTools = null;
        logger.info('ToolHandler', 'Configured with all tools included by default');
      }
      
      // Set up excluded tools if specified
      if (config.excludeTools && config.excludeTools.length > 0) {
        this.excludedTools = new Set(config.excludeTools.map(tool => tool));
        logger.info('ToolHandler', 'Configured with specific excluded tools', JSON.stringify([...this.excludedTools]));
      } else {
        // If not specified, no tools are excluded by default
        this.excludedTools = new Set();
      }
      
      // For backward compatibility, keep this null since we're using the new approach
      this.enabledTools = null;
    } 
    
    // Re-setup tool definitions to apply configuration
    this.setupToolDefinitions();
  }

  /**
   * Check if a tool is enabled
   * @param toolName Name of the tool to check
   * @returns True if the tool is enabled, false otherwise
   */
  private isToolEnabled(toolName: GitToolName): boolean {
    // First check if using new include/exclude configuration
    if (this.includedTools !== null || this.excludedTools.size > 0) {
      // If tool is in excluded list, it's disabled regardless of include settings
      if (this.excludedTools.has(toolName)) {
        return false;
      }
      
      // If no specific included tools are configured, all non-excluded tools are enabled
      if (this.includedTools === null) {
        return true;
      }
      
      // Otherwise, check if the tool is in the included tools set
      return this.includedTools.has(toolName);
    }
    // Legacy mode
    else {
      // If no specific enabled tools are configured, all tools are enabled
      if (this.enabledTools === null) {
        return true;
      }
      
      // Otherwise, check if the tool is in the enabled tools set
      return this.enabledTools.has(toolName);
    }
  }

  private getOperationName(toolName: GitToolName): string {
    return `${ToolHandler.TOOL_PREFIX}.${toolName}`;
  }

  private validateArguments<T extends BasePathOptions>(operation: string, args: unknown, validator: (obj: any) => obj is T): T {
    if (!args || !validator(args)) {
      throw ErrorHandler.handleValidationError(
        new Error(`Invalid arguments for operation: ${operation}`),
        { 
          operation,
          details: { args }
        }
      );
    }

    // If path is not provided, use default path from environment
    if (!args.path && process.env.GIT_DEFAULT_PATH) {
      args.path = process.env.GIT_DEFAULT_PATH;
      logger.info(operation, 'Using default git path', args.path);
    }

    return args;
  }

  private setupHandlers(): void {
    this.setupToolDefinitions();
    this.setupToolExecutor();
  }

  private setupToolDefinitions(): void {
    // Define all available tools with their configurations
    const allTools = [
      // Only include if the tool is enabled
      this.isToolEnabled('init') ? {
        name: 'init',
        description: 'Initialize a new Git repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to initialize the repository in. ${PATH_DESCRIPTION}`,
            },
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('clone') ? {
        name: 'clone',
        description: 'Clone a repository',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL of the repository to clone',
            },
            path: {
              type: 'string',
              description: `Path to clone into. ${PATH_DESCRIPTION}`,
            },
          },
          required: ['url'],
        },
      } : null,
      
      this.isToolEnabled('status') ? {
        name: 'status',
        description: 'Get repository status',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('add') ? {
        name: 'add',
        description: 'Stage files',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            files: {
              type: 'array',
              items: {
                type: 'string',
                description: FILE_PATH_DESCRIPTION,
              },
              description: 'Files to stage',
            },
          },
          required: ['files'],
        },
      } : null,
      
      this.isToolEnabled('commit') ? {
        name: 'commit',
        description: 'Commit changes to repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}. If not provided, the current working directory will be used.`,
            },
            message: {
              type: 'string',
              description: 'Commit message',
            },
            templatePath: {
              type: 'string',
              description: 'Path to a file containing context/instructions for the model to format the commit message. The file content serves as a prompt rather than a literal template.',
            },
            commit_type: {
              type: 'string',
              description: 'Type of commit (e.g., "feat", "fix", "docs", "chore", etc.)',
            },
            all: {
              type: 'boolean',
              description: 'Whether to stage all changes before committing',
            },
          },
          required: ['message'],
        },
      } : null,
      
      this.isToolEnabled('push') ? {
        name: 'push',
        description: 'Push commits to remote',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            remote: {
              type: 'string',
              description: 'Remote name',
              default: 'origin',
            },
            branch: {
              type: 'string',
              description: 'Branch name',
            },
            force: {
              type: 'boolean',
              description: 'Force push changes',
              default: false
            },
            noVerify: {
              type: 'boolean',
              description: 'Skip pre-push hooks',
              default: false
            },
            tags: {
              type: 'boolean',
              description: 'Push all tags',
              default: false
            }
          },
          required: ['branch'],
        },
      } : null,
      
      this.isToolEnabled('pull') ? {
        name: 'pull',
        description: 'Pull changes from remote',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            remote: {
              type: 'string',
              description: 'Remote name',
              default: 'origin',
            },
            branch: {
              type: 'string',
              description: 'Branch name',
            },
          },
          required: ['branch'],
        },
      } : null,
      
      this.isToolEnabled('branch_list') ? {
        name: 'branch_list',
        description: 'List branches',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('branch_create') ? {
        name: 'branch_create',
        description: 'Create a new branch',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            name: {
              type: 'string',
              description: 'Branch name',
            },
            force: {
              type: 'boolean',
              description: 'Force create branch even if it exists',
              default: false
            },
            track: {
              type: 'boolean',
              description: 'Set up tracking mode',
              default: true
            },
            setUpstream: {
              type: 'boolean',
              description: 'Set upstream for push/pull',
              default: false
            }
          },
          required: ['name'],
        },
      } : null,
      
      this.isToolEnabled('branch_delete') ? {
        name: 'branch_delete',
        description: 'Delete a branch',
        inputSchema: {
          type: 'object',
          properties: { 
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            name: {
              type: 'string', 
              description: 'Branch name',
            },
          },
          required: ['name'],
        },
      } : null,
      
      this.isToolEnabled('checkout') ? {
        name: 'checkout',
        description: 'Switch branches or restore working tree files',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            target: {
              type: 'string',
              description: 'Branch name, commit hash, or file path',
            },
          },
          required: ['target'],
        },
      } : null,
      
      this.isToolEnabled('tag_list') ? {
        name: 'tag_list',
        description: 'List tags',
        inputSchema: {
          type: 'object',
          properties: { 
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
          },
          required: [],
        },
      } : null, 
      
      this.isToolEnabled('tag_create') ? {
        name: 'tag_create',
        description: 'Create a new tag',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            name: {
              type: 'string',
              description: 'Tag name',
            },
            message: {
              type: 'string',
              description: 'Tag message',
            },
            force: {
              type: 'boolean',
              description: 'Force create tag even if it exists',
              default: false
            },
            annotated: {
              type: 'boolean',
              description: 'Create an annotated tag',
              default: false
            },
            sign: {
              type: 'boolean',
              description: 'Create a signed tag',
              default: false
            }
          },
          required: ['name'],
        },
      } : null,

      this.isToolEnabled('tag_delete') ? {
        name: 'tag_delete',
        description: 'Delete a tag',
        inputSchema: {
          type: 'object',
          properties: { 
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            name: {
              type: 'string', 
              description: 'Tag name',
            },
          },
          required: ['name'],
        },
      } : null,
      
        this.isToolEnabled('remote_list') ? {
        name: 'remote_list',
        description: 'List remotes',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('remote_add') ? {
        name: 'remote_add',
        description: 'Add a remote',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            name: {
              type: 'string',
              description: 'Remote name',
            },
            url: {
              type: 'string',
              description: 'Remote URL',
            },
          },
          required: ['name', 'url'],
        },
      } : null,
      
      this.isToolEnabled('remote_remove') ? {
        name: 'remote_remove',
        description: 'Remove a remote',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            name: {
              type: 'string',
              description: 'Remote name',
            },
          },
          required: ['name'],
        },
      } : null,
      
      this.isToolEnabled('stash_list') ? {
        name: 'stash_list',
        description: 'List stashes',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('stash_save') ? {
        name: 'stash_save',
        description: 'Save changes to stash',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            message: {
              type: 'string',
              description: 'Stash message',
            },
            includeUntracked: {
              type: 'boolean',
              description: 'Include untracked files',
              default: false
            },
            keepIndex: {
              type: 'boolean',
              description: 'Keep staged changes',
              default: false
            },
            all: {
              type: 'boolean',
              description: 'Include ignored files',
              default: false
            }
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('stash_pop') ? {
        name: 'stash_pop',
        description: 'Apply and remove a stash',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            index: {
              type: 'number',
              description: 'Stash index',
              default: 0,
            },
          },
          required: [],
        },
      } : null,
      
      this.isToolEnabled('bulk_action') ? {
        name: 'bulk_action',
        description: 'Execute multiple git actions sequentially',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Path to repository. ${PATH_DESCRIPTION}`,
            },
            actions: {
              type: 'array',
              description: 'List of actions to execute',
              items: {
                type: 'object',
                oneOf: [
                  {
                    properties: {
                      type: { enum: ['stage'] },
                      files: {
                        type: 'array',
                        description: 'Files to stage (default: all files)',
                        items: { 
                          type: 'string',
                          description: `File path. ${FILE_PATH_DESCRIPTION}`
                        }
                      }
                    },
                    required: ['type']
                  },
                  {
                    properties: {
                      type: { enum: ['commit'] },
                      message: {
                        type: 'string',
                        description: 'Commit message'
                      },
                      templatePath: {
                        type: 'string',
                        description: 'Path to a file containing context/instructions for the model to format the commit message'
                      },
                      commit_type: {
                        type: 'string',
                        description: 'Type of commit (e.g., "feat", "fix", "docs", "chore", etc.)'
                      },
                      all: {
                        type: 'boolean',
                        description: 'Whether to stage all changes before committing'
                      }
                    },
                    required: ['type', 'message']
                  },
                  {
                    properties: {
                      type: { enum: ['push'] },
                      remote: {
                        type: 'string',
                        description: 'Remote name (default: origin)'
                      },
                      branch: {
                        type: 'string',
                        description: 'Branch to push'
                      }
                    },
                    required: ['type', 'branch']
                  }
                ]
              }
            }
          },
          required: ['actions'],
        },
      } : null,
    ];
    
    // Register tools with the server, filtering out the nulls (disabled tools)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const enabledTools = allTools.filter(Boolean) as any[]; // TS filter(Boolean) type guard needs help
      logger.debug('ToolHandler', 'Registered enabled tools', JSON.stringify(enabledTools.map(t => t.name)));
      return { tools: enabledTools };
    });
  }

  private setupToolExecutor(): void {
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name as GitToolName;
      
      // Check if the tool is enabled
      if (!this.isToolEnabled(toolName)) {
        throw ErrorHandler.handleValidationError(
          new Error(`Tool is not enabled: ${toolName}`),
          { operation: this.getOperationName(toolName) }
        );
      }
      
      const operation = this.getOperationName(toolName);
      const args = request.params.arguments;
      const context = { operation, path: args?.path as string | undefined };

      try {
        switch (toolName) {
          case 'init': {
            const validArgs = this.validateArguments(operation, args, isInitOptions);
            return await GitOperations.init(validArgs, context);
          }

          case 'clone': {
            const validArgs = this.validateArguments(operation, args, isCloneOptions);
            return await GitOperations.clone(validArgs, context);
          }

          case 'status': {
            const validArgs = this.validateArguments(operation, args, isPathOnly);
            return await GitOperations.status(validArgs, context);
          }

          case 'add': {
            const validArgs = this.validateArguments(operation, args, isAddOptions);
            return await GitOperations.add(validArgs, context);
          }

          case 'commit': {
            const validArgs = this.validateArguments(operation, args, isCommitOptions);
            return await GitOperations.commit(
              validArgs, 
              context
            );
          }

          case 'push': {
            const validArgs = this.validateArguments(operation, args, isPushPullOptions);
            return await GitOperations.push(validArgs, context);
          }

          case 'pull': {
            const validArgs = this.validateArguments(operation, args, isPushPullOptions);
            return await GitOperations.pull(validArgs, context);
          }

          case 'branch_list': {
            const validArgs = this.validateArguments(operation, args, isPathOnly);
            return await GitOperations.branchList(validArgs, context);
          }

          case 'branch_create': {
            const validArgs = this.validateArguments(operation, args, isBranchOptions);
            return await GitOperations.branchCreate(validArgs, context);
          }

          case 'branch_delete': {
            const validArgs = this.validateArguments(operation, args, isBranchOptions);
            return await GitOperations.branchDelete(validArgs, context);
          }

          case 'checkout': {
            const validArgs = this.validateArguments(operation, args, isCheckoutOptions);
            return await GitOperations.checkout(validArgs, context);
          }

          case 'tag_list': {
            const validArgs = this.validateArguments(operation, args, isPathOnly);
            return await GitOperations.tagList(validArgs, context);
          }

          case 'tag_create': {
            const validArgs = this.validateArguments(operation, args, isTagOptions);
            return await GitOperations.tagCreate(validArgs, context);
          }

          case 'tag_delete': {
            const validArgs = this.validateArguments(operation, args, isTagOptions);
            return await GitOperations.tagDelete(validArgs, context);
          }

          case 'remote_list': {
            const validArgs = this.validateArguments(operation, args, isPathOnly);
            return await GitOperations.remoteList(validArgs, context);
          }

          case 'remote_add': {
            const validArgs = this.validateArguments(operation, args, isRemoteOptions);
            return await GitOperations.remoteAdd(validArgs, context);
          }

          case 'remote_remove': {
            const validArgs = this.validateArguments(operation, args, isRemoteOptions);
            return await GitOperations.remoteRemove(validArgs, context);
          }

          case 'stash_list': {
            const validArgs = this.validateArguments(operation, args, isPathOnly);
            return await GitOperations.stashList(validArgs, context);
          }

          case 'stash_save': {
            const validArgs = this.validateArguments(operation, args, isStashOptions);
            return await GitOperations.stashSave(validArgs, context);
          }

          case 'stash_pop': {
            const validArgs = this.validateArguments(operation, args, isStashOptions);
            return await GitOperations.stashPop(validArgs, context);
          }

          case 'bulk_action': {
            const validArgs = this.validateArguments(operation, args, isBulkActionOptions);
            return await GitOperations.executeBulkActions(validArgs, context);
          }


          default:
            throw ErrorHandler.handleValidationError(
              new Error(`Unknown tool: ${toolName}`),
              { operation }
            );
        }
      } catch (error: unknown) {
        // If it's already a GitMcpError or McpError, rethrow it
        if (error instanceof GitMcpError || error instanceof McpError) {
          throw error;
        }

        // Otherwise, wrap it in an appropriate error type
        throw ErrorHandler.handleOperationError(
          error instanceof Error ? error : new Error('Unknown error'),
          {
            operation,
            path: context.path,
            details: { tool: request.params.name }
          }
        );
      }
    });
  }
}
