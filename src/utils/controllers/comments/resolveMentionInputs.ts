import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import {
  resolveMentionEntries,
  type MentionProblem,
  type ResolvableMember,
} from "./resolveMentions";

export interface MentionObjectInput {
  user_id?: number;
  agent_id?: string;
  display_name?: string;
}

export type RawMentionInput = string | MentionObjectInput;

export interface ResolvedMentionInput {
  user_id: number;
  display_name: string;
}

export interface MentionInputResolution {
  mentions: ResolvedMentionInput[];
  problems: MentionProblem[];
  invalid: boolean;
}

function isMentionObject(input: RawMentionInput): input is MentionObjectInput {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function isValidMentionObject(input: MentionObjectInput): boolean {
  return (
    typeof input.user_id === "number" &&
    Number.isInteger(input.user_id) &&
    input.user_id > 0 &&
    typeof input.display_name === "string" &&
    input.display_name.trim().length > 0
  );
}

export async function resolveMentionInputs(params: {
  inputs: RawMentionInput[];
  projectId: number;
  requestingUserId: number;
}): Promise<MentionInputResolution> {
  const { inputs, projectId, requestingUserId } = params;
  const mentions: ResolvedMentionInput[] = [];
  const problems: MentionProblem[] = [];
  let invalid = false;
  const names: string[] = [];

  for (const input of inputs) {
    if (typeof input === "string") {
      names.push(input);
      continue;
    }
    if (!isMentionObject(input) || !isValidMentionObject(input)) {
      invalid = true;
      continue;
    }
    mentions.push({
      user_id: input.user_id as number,
      display_name: (input.display_name as string).trim(),
    });
  }

  if (names.length > 0) {
    const { members, error } = await getProjectMembers(
      projectId,
      undefined,
      requestingUserId,
    );
    if (error || !members) {
      return {
        mentions,
        problems: names.map((name) => ({
          input: name,
          reason: "unknown" as const,
          closeMatches: [],
        })),
        invalid,
      };
    }
    const resolvable: ResolvableMember[] = members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
    }));
    const { resolved, problems: nameProblems } = resolveMentionEntries(
      names,
      resolvable,
    );
    for (const mention of resolved) {
      mentions.push({ user_id: mention.userId, display_name: mention.displayName });
    }
    problems.push(...nameProblems);
  }

  return { mentions, problems, invalid };
}

export function mentionProblemMessage(problem: MentionProblem): string {
  const close = problem.closeMatches.length
    ? ` Did you mean ${problem.closeMatches.map((name) => `"${name}"`).join(" or ")}?`
    : " No board member matches that name; list them with list_project_members.";
  return problem.reason === "ambiguous"
    ? `@${problem.input} matches more than one person on this board.${close}`
    : `@${problem.input} is not a person on this board.${close}`;
}
