import { SetBoardGithubReposInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { ProjectService } from '../lib/services/project.service';

export const setBoardGithubReposTool = {
  name: TOOL_METADATA.SET_BOARD_GITHUB_REPOS.name,
  description: TOOL_METADATA.SET_BOARD_GITHUB_REPOS.description,
  parameters: SetBoardGithubReposInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    ProjectService,
    'setBoardGithubRepos',
    args,
  ),
};
