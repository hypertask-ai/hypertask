import { TOOL_METADATA } from '../config/tool-metadata';
import { UserService } from '../lib/services/user.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getUpdateProfileBaseSchema,
  UpdateProfileInputSchema,
} from '../validations/user.validation';

export const updateProfileTool = {
  name: TOOL_METADATA.UPDATE_PROFILE.name,
  description: TOOL_METADATA.UPDATE_PROFILE.description,
  parameters: getUpdateProfileBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = UpdateProfileInputSchema.parse(args);
    return executeWithService(
      context,
      UserService,
      'updateProfile',
      validatedInput
    );
  },
};
