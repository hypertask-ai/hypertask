/**
 * MCP Standards Configuration
 * 
 * Centralized configuration for MCP best practices enforcement.
 * This ensures consistent tool naming, validation, and standards across the codebase.
 */

/**
 * Service prefix for all tools
 * Following MCP best practice: Name Tools for Discovery
 * Pattern: {service}_{action}_{resource}
 */
export const SERVICE_PREFIX = 'hypertask';

/**
 * Validates that a tool name follows the service prefix convention
 * 
 * @param toolName - The tool name to validate
 * @returns true if valid, throws error if invalid
 * @throws Error if tool name doesn't start with service prefix
 */
export function validateToolName(toolName: string): boolean {
  if (!toolName.startsWith(`${SERVICE_PREFIX}_`)) {
    throw new Error(
      `Tool name "${toolName}" must start with "${SERVICE_PREFIX}_" prefix. ` +
      `Following MCP best practice: Name Tools for Discovery. ` +
      `Expected format: ${SERVICE_PREFIX}_{action}_{resource}`
    );
  }
  return true;
}

/**
 * Builds a tool name with the service prefix
 * Automatically prefixes tool names to ensure consistency
 * 
 * @param baseName - Base tool name (e.g., "get_tasks", "list_projects")
 * @returns Prefixed tool name (e.g., "hypertask_get_tasks")
 */
export function buildToolName(baseName: string): string {
  // Remove any existing prefix to avoid double-prefixing
  const cleanName = baseName.startsWith(`${SERVICE_PREFIX}_`)
    ? baseName.slice(SERVICE_PREFIX.length + 1)
    : baseName;
  
  return `${SERVICE_PREFIX}_${cleanName}`;
}

/**
 * Validates multiple tool names at once
 * Useful for bulk validation during server initialization
 * 
 * @param toolNames - Array of tool names to validate
 * @returns Array of validation results
 */
export function validateToolNames(toolNames: string[]): Array<{ name: string; valid: boolean; error?: string }> {
  return toolNames.map((name) => {
    try {
      validateToolName(name);
      return { name, valid: true };
    } catch (error) {
      return {
        name,
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
