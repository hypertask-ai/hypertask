import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';
import { UpdateProfileInputSchema } from '../../validations/user.validation';

export interface UserProfile {
  id: number;
  email: string;
  displayName?: string;
  photoURL?: string;
}

export interface UpdateUserProfileResponse {
  success: boolean;
  user: UserProfile;
}

/**
 * Service for user profile operations.
 */
export class UserService {
  constructor(private readonly apiClient: IApiClient) {}

  async updateProfile(params: unknown): Promise<UpdateUserProfileResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = UpdateProfileInputSchema.parse(params);
      const body: Record<string, unknown> = {};
      if (validatedInput.displayName !== undefined) body.displayName = validatedInput.displayName;
      if (validatedInput.photoURL !== undefined) body.photoURL = validatedInput.photoURL;

      logger.debug('Updating user profile', {
        correlationId,
        fields: Object.keys(body),
      });

      const response = await this.apiClient.makeRequest<UpdateUserProfileResponse>(
        '/mcp/user/profile',
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
        correlationId
      );

      return response;
    } catch (error) {
      logger.error('Failed to update user profile', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
