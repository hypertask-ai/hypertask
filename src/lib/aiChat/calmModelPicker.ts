export type CalmModelSource = {
  key: string;
  label: string;
  provider: string;
  priceTier?: 1 | 2 | 3;
  description?: string;
};

export type CalmModelRow = {
  key: string;
  label: string;
  providerLabel: string;
  price: string;
};

export function calmModelRows(
  providers: readonly { key: string; label: string }[],
  models: readonly CalmModelSource[],
): CalmModelRow[] {
  const rows: CalmModelRow[] = [];
  for (const provider of providers) {
    for (const model of models) {
      if (model.provider !== provider.key) continue;
      rows.push({
        key: model.key,
        label: model.label,
        providerLabel: provider.label,
        price: model.priceTier ? "$".repeat(model.priceTier) : "",
      });
    }
  }
  return rows;
}
