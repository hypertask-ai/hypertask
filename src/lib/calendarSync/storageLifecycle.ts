export const canRunCalendarStorageOperation = ({
  startedGeneration,
  currentGeneration,
  operationsDisabled,
}: {
  startedGeneration: number;
  currentGeneration: number;
  operationsDisabled: boolean;
}): boolean =>
  !operationsDisabled && startedGeneration === currentGeneration;
