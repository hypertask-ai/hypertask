/**
 * Manual check: agent-bound MCP/OAuth JWTs have no exp; user tokens do.
 * Run: npx tsx src/scripts/verify-agent-jwt.ts
 */
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(32);
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "hypertask";

import { createMcpToken, createOAuthToken } from "../lib/mcp/auth";

const AGENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AGENT_TOKEN_JTI = "agent-token-generation";

const mcpAgent = createMcpToken(1, "t@example.com", "1h", AGENT_ID);
const mcpAgentDecoded = jwt.decode(mcpAgent) as jwt.JwtPayload;
if (mcpAgentDecoded.agentId !== AGENT_ID) {
  throw new Error("createMcpToken should embed agentId");
}
if (mcpAgentDecoded.exp !== undefined) {
  throw new Error("createMcpToken with agentId should not set exp");
}

const mcpPlain = createMcpToken(2, "u@example.com", "1h");
const plainDecoded = jwt.decode(mcpPlain) as jwt.JwtPayload;
if (plainDecoded.agentId !== undefined) {
  throw new Error("createMcpToken without agent should omit agentId");
}
if (plainDecoded.exp === undefined) {
  throw new Error("createMcpToken without agent should set exp");
}

const oauthAgent = createOAuthToken(
  "firebase-uid",
  3,
  "o@example.com",
  3600,
  AGENT_ID,
  AGENT_TOKEN_JTI
);
const oauthAgentDecoded = jwt.decode(oauthAgent) as jwt.JwtPayload;
if (oauthAgentDecoded.agentId !== AGENT_ID) {
  throw new Error("createOAuthToken should embed agentId");
}
if (oauthAgentDecoded.exp !== undefined) {
  throw new Error("createOAuthToken with agentId should not set exp");
}
if (oauthAgentDecoded.agentTokenGeneration !== AGENT_TOKEN_JTI) {
  throw new Error("createOAuthToken should retain the agent token generation");
}
if (typeof oauthAgentDecoded.jti !== "string" || oauthAgentDecoded.jti === AGENT_TOKEN_JTI) {
  throw new Error("createOAuthToken should use a distinct OAuth jti");
}

const oauthUser = createOAuthToken("firebase-uid-2", 4, "u@example.com", 3600);
const oauthUserDecoded = jwt.decode(oauthUser) as jwt.JwtPayload;
if (oauthUserDecoded.exp === undefined) {
  throw new Error("createOAuthToken without agent should set exp");
}

console.log("verify-agent-jwt: OK");
