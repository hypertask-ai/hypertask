import { searchHelpDocs, type HelpDocsSearchResponse } from '../../../help-docs/searchHelpDocs';
import type { IApiClient } from '../../types/index';
import { SearchHelpDocsInputSchema } from '../../validations/help-docs.validation';

export class HelpDocsService {
  constructor(_apiClient: IApiClient) {}

  async searchHelpDocs(params: unknown): Promise<HelpDocsSearchResponse> {
    const input = SearchHelpDocsInputSchema.parse(params);
    return searchHelpDocs(input);
  }
}
