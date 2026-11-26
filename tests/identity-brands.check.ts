import type { AgentId, UserId, AssigneeIdentity } from "../src/lib/identity";
import type assigneesAssign from "../src/utils/controllers/assignees/assign";
import type {
  archiveOwnedAgent,
  launchOwnedAgent,
  renameOwnedAgent,
} from "../src/lib/mcp/agents/lifecycle";
import type { McpTaskAssignee } from "../src/lib/mcp/tasks/types";
import type { injectMentionSpans, ResolvedMentionTarget } from "../src/utils/controllers/comments/resolveMentions";

type Reject<T extends false> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;

export type IdentityContracts = [
  Reject<Assignable<string, AgentId>>,
  Reject<Assignable<number, UserId>>,
  Reject<Assignable<AgentId, UserId>>,
  Reject<Assignable<UserId, AgentId>>,
  Reject<Assignable<string, Parameters<typeof assigneesAssign>[3]>>,
  Reject<Assignable<number, Parameters<typeof assigneesAssign>[1]>>,
  Reject<Assignable<UserId, Parameters<typeof assigneesAssign>[3]>>,
  Reject<Assignable<AgentId, Parameters<typeof assigneesAssign>[1]>>,
  Reject<Assignable<string, Parameters<typeof launchOwnedAgent>[3]>>,
  Reject<Assignable<number, Parameters<typeof launchOwnedAgent>[2]>>,
  Reject<Assignable<UserId, Parameters<typeof launchOwnedAgent>[3]>>,
  Reject<Assignable<UserId, Parameters<typeof archiveOwnedAgent>[2]>>,
  Reject<Assignable<UserId, Parameters<typeof renameOwnedAgent>[2]>>,
  Reject<Assignable<{ userId: UserId }, AssigneeIdentity>>,
  Reject<Assignable<{ userId: UserId; agentId: AgentId }, AssigneeIdentity>>,
  Reject<Assignable<{ userId: UserId }, McpTaskAssignee>>,
  Reject<Assignable<{ type: "person"; id: UserId; email: string; agentId: AgentId }, McpTaskAssignee>>,
  Reject<Assignable<{ agent_id: UserId; display_name: string }, ResolvedMentionTarget>>,
  Reject<Assignable<string, Parameters<typeof injectMentionSpans>[0]>>,
];
