import { GET as readGithub, PUT as saveGithub } from "@/lib/mcp/operations/projects/[projectId]/github/operation";

export const GET = readGithub;
export const PUT = saveGithub;
