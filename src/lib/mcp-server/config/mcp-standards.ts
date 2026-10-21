
export const SERVICE_PREFIX = 'hypertask';

export function validateToolName(toolName: string): boolean {
  if (!toolName.startsWith(`${SERVICE_PREFIX}_`)) {
    throw new Error(
      `Tool name "${toolName}" must start with "${SERVICE_PREFIX}_" prefix. ` +
      `Following MCP best practice: Name Tools for Discovery. ` +
      `Expected format: ${SERVICE_PREFIX}_{action}_{resource}`
    );
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(toolName)) {
    throw new Error(`Tool name "${toolName}" must match [A-Za-z0-9._-]{1,128}`);
  }
  return true;
}

export function buildToolName(baseName: string): string {
  const cleanName = baseName.startsWith(`${SERVICE_PREFIX}_`)
    ? baseName.slice(SERVICE_PREFIX.length + 1)
    : baseName;
  
  return `${SERVICE_PREFIX}_${cleanName}`;
}

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
