import { getBoardManifestInputSchema } from '../validations/project.validation';
import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: board_manifest
 * Gets a board's ordered column structure and semantic roles.
 */
export const boardManifestTool = {
  name: TOOL_METADATA.BOARD_MANIFEST.name,
  description: TOOL_METADATA.BOARD_MANIFEST.description,
  parameters: getBoardManifestInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      ProjectService,
      'getBoardManifest',
      args
    );
  },
};
