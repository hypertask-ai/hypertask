import { BoardGithubReposInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { ProjectService } from '../lib/services/project.service';

export const listBoardGithubReposTool = {
  name: TOOL_METADATA.LIST_BOARD_GITHUB_REPOS.name,
  description: TOOL_METADATA.LIST_BOARD_GITHUB_REPOS.description,
  parameters: BoardGithubReposInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    ProjectService,
    'listBoardGithubRepos',
    args,
  ),
};
