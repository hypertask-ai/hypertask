import type { IApiClient } from '../../types/index';
import { generateCorrelationId } from '../../utils/correlation';
import { logger } from '../../utils/logger';
import {
  ListCustomFieldsInputSchema,
  SetCustomFieldValueInputSchema,
} from '../../validations/custom-field.validation';

export type CustomFieldType =
  | 'Text'
  | 'Number'
  | 'Date'
  | 'Select'
  | 'Checkbox';

export interface CustomFieldOption {
  id: string;
  label: string;
  color?: string;
}

export interface CustomFieldDefinition {
  id: string;
  projectId: number;
  name: string;
  type: CustomFieldType;
  options: CustomFieldOption[] | null;
  ranking: string;
  showInRail: boolean | null;
  showInTable: boolean | null;
  createdAt: string;
  valueCount: number;
}

export interface ListCustomFieldsResponse {
  success: true;
  projectId: number;
  customFields: CustomFieldDefinition[];
}

export interface CustomFieldValue {
  id: string;
  fieldId: string;
  taskId: number;
  value: string;
  numericValue: number | null;
  updatedAt: string;
}

export interface SetCustomFieldValueResponse {
  success: true;
  taskId: number;
  customField: {
    id: string;
    name: string;
    type: CustomFieldType;
  } | null;
  customFieldValue: CustomFieldValue | null;
  deleted?: true;
}

export class CustomFieldService {
  constructor(private readonly apiClient: IApiClient) {}

  async listCustomFields(params: unknown): Promise<ListCustomFieldsResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ListCustomFieldsInputSchema.parse(params);
      return await this.apiClient.makeRequest<ListCustomFieldsResponse>(
        `/mcp/custom-fields?project_id=${validatedInput.project_id}`,
        { method: 'GET' },
        correlationId
      );
    } catch (error) {
      logger.failure('Failed to list custom fields', error, {
        correlationId,
      });
      throw error;
    }
  }

  async setCustomFieldValue(
    params: unknown
  ): Promise<SetCustomFieldValueResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = SetCustomFieldValueInputSchema.parse(params);
      return await this.apiClient.makeRequest<SetCustomFieldValueResponse>(
        '/mcp/custom-fields/value',
        { method: 'POST', body: JSON.stringify(validatedInput) },
        correlationId
      );
    } catch (error) {
      logger.failure('Failed to set custom field value', error, {
        correlationId,
      });
      throw error;
    }
  }
}
