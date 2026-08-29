import type { IApiClient } from '../../types/index';
import {
  validateAndSanitizeCreateSkillInput,
  validateAndSanitizeDeleteSkillInput,
  validateAndSanitizeGetSkillInput,
  validateAndSanitizeImportSkillsInput,
  validateAndSanitizeListSkillsInput,
  validateAndSanitizeUpdateSkillInput,
} from '../../validations/skill.validation';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';

export interface Skill {
  id: number;
  projectId: number | null;
  userId: number | null;
  slug: string;
  name: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
  sourceUrl: string | null;
  enabled: boolean;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSkillsResponse {
  success: boolean;
  skills: Skill[];
  total: number;
}

export interface SkillResponse {
  success: boolean;
  skill: Skill;
}

export interface ImportSkillsResponse {
  success: boolean;
  skills: Skill[];
  total: number;
}

export interface DeleteSkillResponse {
  success: boolean;
}

/**
 * Service for listing, retrieving, creating, updating, deleting, and importing skills.
 * Validates input and makes API requests.
 */
export class SkillService {
  constructor(private readonly apiClient: IApiClient) {}

  async listSkills(params: unknown): Promise<ListSkillsResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeListSkillsInput(params);
      const queryParams = new URLSearchParams();

      if (validatedInput.project_id !== undefined) {
        queryParams.append('project_id', String(validatedInput.project_id));
      }

      logger.debug('Listing skills', {
        correlationId,
        projectId: validatedInput.project_id,
      });

      const query = queryParams.toString();
      const response = await this.apiClient.makeRequest<ListSkillsResponse>(
        query ? `/mcp/skills?${query}` : '/mcp/skills',
        {
          method: 'GET',
        },
        correlationId
      );

      logger.info('Skills listed successfully', {
        correlationId,
        skillCount: response.skills?.length ?? 0,
        total: response.total,
      });

      return response;
    } catch (error) {
      logger.error('Failed to list skills', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getSkill(params: unknown): Promise<SkillResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeGetSkillInput(params);

      logger.debug('Getting skill', {
        correlationId,
        skillId: validatedInput.skill_id,
      });

      const response = await this.apiClient.makeRequest<SkillResponse>(
        `/mcp/skills/${validatedInput.skill_id}`,
        {
          method: 'GET',
        },
        correlationId
      );

      logger.info('Skill retrieved successfully', {
        correlationId,
        skillId: response.skill.id,
      });

      return response;
    } catch (error) {
      logger.error('Failed to get skill', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createSkill(params: unknown): Promise<SkillResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeCreateSkillInput(params);

      logger.debug('Creating skill', {
        correlationId,
        scope: validatedInput.scope,
        projectId: validatedInput.project_id,
        slug: validatedInput.slug,
        fromMarkdown: validatedInput.markdown !== undefined,
      });

      const response = await this.apiClient.makeRequest<SkillResponse>(
        '/mcp/skills',
        {
          method: 'POST',
          body: JSON.stringify(validatedInput),
        },
        correlationId
      );

      logger.info('Skill created successfully', {
        correlationId,
        skillId: response.skill.id,
        slug: response.skill.slug,
      });

      return response;
    } catch (error) {
      logger.error('Failed to create skill', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updateSkill(params: unknown): Promise<SkillResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeUpdateSkillInput(params);
      const { skill_id: skillId, ...body } = validatedInput;

      logger.debug('Updating skill', {
        correlationId,
        skillId,
        fields: Object.keys(body),
      });

      const response = await this.apiClient.makeRequest<SkillResponse>(
        `/mcp/skills/${skillId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
        correlationId
      );

      logger.info('Skill updated successfully', {
        correlationId,
        skillId,
      });

      return response;
    } catch (error) {
      logger.error('Failed to update skill', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteSkill(params: unknown): Promise<DeleteSkillResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeDeleteSkillInput(params);

      logger.debug('Deleting skill', {
        correlationId,
        skillId: validatedInput.skill_id,
      });

      const response = await this.apiClient.makeRequest<DeleteSkillResponse>(
        `/mcp/skills/${validatedInput.skill_id}`,
        {
          method: 'DELETE',
        },
        correlationId
      );

      logger.info('Skill deleted successfully', {
        correlationId,
        skillId: validatedInput.skill_id,
      });

      return response;
    } catch (error) {
      logger.error('Failed to delete skill', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async importSkills(params: unknown): Promise<ImportSkillsResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = validateAndSanitizeImportSkillsInput(params);

      logger.debug('Importing skills', {
        correlationId,
        url: validatedInput.url,
        scope: validatedInput.scope,
        projectId: validatedInput.project_id,
        dryRun: validatedInput.dry_run,
        slugs: validatedInput.slugs,
      });

      const response = await this.apiClient.makeRequest<ImportSkillsResponse>(
        '/mcp/skills/import',
        {
          method: 'POST',
          body: JSON.stringify(validatedInput),
        },
        correlationId
      );

      logger.info('Skills imported successfully', {
        correlationId,
        skillCount: response.skills?.length ?? 0,
        total: response.total,
        dryRun: validatedInput.dry_run,
      });

      return response;
    } catch (error) {
      logger.error('Failed to import skills', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
