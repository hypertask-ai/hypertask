/**
 * Priority and Estimate constants matching the frontend implementation
 * These constants map indices to their correct values
 */

export interface PriorityConstant {
  priority_index: number;
  Priority_Value: 'No Priority' | 'Urgent' | 'High' | 'Medium' | 'Low';
  colorCode: string;
}

export interface EstimateConstant {
  estimate_index: number;
  estimate_value: string;
  estimate_full_value: string;
  colorCode: string;
}

export const PriorityConstants: PriorityConstant[] = [
  {
    priority_index: 0,
    Priority_Value: 'No Priority',
    colorCode: 'transparent',
  },
  {
    priority_index: 1,
    Priority_Value: 'Urgent',
    colorCode: '#F88F9C', // UrgentPriorityColor
  },
  {
    priority_index: 2,
    Priority_Value: 'High',
    colorCode: '#DE9D6E',
  },
  {
    priority_index: 3,
    Priority_Value: 'Medium',
    colorCode: '#C2CFA5',
  },
  {
    priority_index: 4,
    Priority_Value: 'Low',
    colorCode: '#95999E',
  },
];

/**
 * Product-backed estimate indices only (staging API rejects other values, e.g. 7).
 * Note: there is no index 1; spacing matches the HyperTasks UI.
 */
export const EstimateConstants: EstimateConstant[] = [
  {
    estimate_index: 0,
    estimate_value: '-',
    estimate_full_value: 'No size',
    colorCode: 'transparent',
  },
  {
    estimate_index: 2,
    estimate_value: 'XS',
    estimate_full_value: 'Extra small',
    colorCode: '#DE9D6E',
  },
  {
    estimate_index: 3,
    estimate_value: 'S',
    estimate_full_value: 'Small',
    colorCode: '#C2CFA5',
  },
  {
    estimate_index: 4,
    estimate_value: 'M',
    estimate_full_value: 'Medium',
    colorCode: '#95999E',
  },
  {
    estimate_index: 5,
    estimate_value: 'L',
    estimate_full_value: 'Large',
    colorCode: '#95999E',
  },
  {
    estimate_index: 6,
    estimate_value: 'XL',
    estimate_full_value: 'Extra large',
    colorCode: '#95999E',
  },
];

/** Sorted list of allowed `estimate_index` values for API/MCP (0 and 2–6). */
export const VALID_ESTIMATE_INDICES: readonly number[] = EstimateConstants.map((e) => e.estimate_index);

export function isValidEstimateIndex(value: number): boolean {
  return EstimateConstants.some((e) => e.estimate_index === value);
}

/**
 * Get priority value from priority_index
 * Returns the correct Priority_Value based on the index, ignoring any incorrect API values
 */
export function getPriorityValue(priorityIndex: number): PriorityConstant['Priority_Value'] {
  const priority = PriorityConstants.find((p) => p.priority_index === priorityIndex);
  return priority?.Priority_Value ?? 'No Priority';
}

/**
 * Get priority constant from priority_index
 */
export function getPriorityConstant(priorityIndex: number): PriorityConstant | undefined {
  return PriorityConstants.find((p) => p.priority_index === priorityIndex);
}

/**
 * Get estimate value from estimate_index
 * Returns the correct estimate_value based on the index, ignoring any incorrect API values
 */
export function getEstimateValue(estimateIndex: number): string {
  const estimate = EstimateConstants.find((e) => e.estimate_index === estimateIndex);
  return estimate?.estimate_value ?? '-';
}

/**
 * Get estimate full value from estimate_index
 */
export function getEstimateFullValue(estimateIndex: number): string {
  const estimate = EstimateConstants.find((e) => e.estimate_index === estimateIndex);
  return estimate?.estimate_full_value ?? 'No size';
}

/**
 * Get estimate constant from estimate_index
 */
export function getEstimateConstant(estimateIndex: number): EstimateConstant | undefined {
  return EstimateConstants.find((e) => e.estimate_index === estimateIndex);
}
