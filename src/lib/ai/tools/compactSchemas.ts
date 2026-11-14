import { asSchema, jsonSchema, type ToolSet } from "ai";

export function compactChatToolSchemas(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const schema = asSchema(definition.inputSchema);
    const inputSchema: typeof schema.jsonSchema = JSON.parse(JSON.stringify(schema.jsonSchema, (key, value) => {
      if (key === "$schema") return undefined;
      if (value && typeof value === "object" && value.format === "uuid") {
        return { ...value, pattern: undefined };
      }
      return value;
    }));
    return [name, { ...definition, inputSchema: jsonSchema(inputSchema, { validate: schema.validate }) }];
  }));
}
