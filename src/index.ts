#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ToolHandler } from './tool-handler.js';
import { GitServerConfig, GitToolName } from './types.js';
import { CommandExecutor } from './utils/command.js';
import { logger } from './utils/logger.js';
import { PathResolver } from './utils/paths.js';

/**
 * Helper function to get all valid tool names from the GitToolName type
 * This provides type safety when using string literals
 */
function getValidToolNames(): GitToolName[] {
  return [
    'init',
    'clone',
    'status',
    'add',
    'commit',
    'push',
    'pull',
    'branch_list',
    'branch_create',
    'branch_delete',
    'checkout',
    'tag_list',
    'tag_create',
    'tag_delete',
    'remote_list',
    'remote_add',
    'remote_remove',
    'stash_list',
    'stash_save',
    'stash_pop',
    'bulk_action',
  ];
}

/**
 * Parse MCP server arguments for tool configuration
 * @param args Command line arguments
 * @returns Parsed configuration
 */
function parseArguments(args: string[]): GitServerConfig {
  const config: GitServerConfig = {};
  
  // Get valid tool names
  const validToolNames = getValidToolNames();
  
  // Find arguments for include-tools and exclude-tools
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Check for --include-tools or --exclude-tools
    if (arg === '--include-tools' || arg === '--exclude-tools') {
      // Make sure there's a value following the argument
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        const toolNames = args[i + 1].split(',').map(tool => tool.trim());
        
        // Validate tool names against our list of valid tools
        const validTools = toolNames
          .map(toolName => {
            // Find matching tool name (case insensitive)
            const matchedTool = validToolNames.find(
              validTool => validTool.toLowerCase() === toolName.toLowerCase()
            );
            
            if (!matchedTool) {
              logger.warn('startup', `Invalid tool name ignored: ${toolName}`);
              return null;
            }
            
            return matchedTool;
          })
          .filter(tool => tool !== null) as GitToolName[];
        
        // Add to the appropriate config field
        if (arg === '--include-tools') {
          config.includeTools = validTools;
          if (validTools.length > 0) {
            logger.info('startup', 'Include tools configuration loaded', JSON.stringify(validTools));
          } else {
            logger.warn('startup', 'No valid tools found in --include-tools, all tools will be enabled');
          }
        } else {
          config.excludeTools = validTools;
          if (validTools.length > 0) {
            logger.info('startup', 'Exclude tools configuration loaded', JSON.stringify(validTools));
          }
        }
        
        // Skip the value we just processed
        i++;
      } else {
        logger.warn('startup', `Missing value for ${arg} argument`);
      }
    }
  }
  
  return config;
}

async function validateDefaultPath(): Promise<void> {
  const defaultPath = process.env.GIT_DEFAULT_PATH;
  if (!defaultPath) {
    logger.warn('startup', 'GIT_DEFAULT_PATH not set - absolute paths will be required for all operations');
    return;
  }

  try {
    // Validate the default path exists and is accessible
    PathResolver.validatePath(defaultPath, 'startup', {
      mustExist: true,
      mustBeDirectory: true,
      createIfMissing: true
    });
    logger.info('startup', 'Default git path validated', defaultPath);
  } catch (error) {
    logger.error('startup', 'Invalid GIT_DEFAULT_PATH', defaultPath, error as Error);
    throw new McpError(
      ErrorCode.InternalError,
      `Invalid GIT_DEFAULT_PATH: ${(error as Error).message}`
    );
  }
}

async function main() {
  try {
    // Get the command-line arguments (skip node and script path)
    const args = process.argv.slice(2);
    
    // Process yargs arguments
    const argv = yargs(hideBin(process.argv))
      .option('github_token', {
        description: 'GitHub token for API operations (can also be set via GITHUB_TOKEN env var)',
        type: 'string',
      })
      .parseSync();
    
    // Process configuration from command-line arguments and environment variables
    const config = parseArguments(args);
    
    // Set GitHub token in environment if provided via CLI
    if (argv.github_token) {
      process.env.GITHUB_TOKEN = argv.github_token;
      logger.info('startup', 'GitHub token set from command line argument');
    }

    // Validate git installation first
    await CommandExecutor.validateGitInstallation('startup');
    logger.info('startup', 'Git installation validated');

    // Validate default path if provided
    await validateDefaultPath();

    // Create and configure server
    const server = new Server(
      {
        name: 'git-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up error handling
    server.onerror = (error) => {
      if (error instanceof McpError) {
        logger.error('server', error.message, undefined, error);
      } else {
        logger.error('server', 'Unexpected error', undefined, error as Error);
      }
    };

    // Initialize tool handler
    const toolHandler = new ToolHandler(server);
    // Apply configuration
    toolHandler.configure(config);

    // Connect server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('server', 'Git MCP server running on stdio');

    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('server', 'Shutting down server');
      await server.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('startup', 'Failed to start server', undefined, error as Error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
