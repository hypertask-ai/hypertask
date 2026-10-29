export function unresolvedLabelMessage(
    unresolved: string[],
    projectLabels: { value: string | null }[]
): string {
    const available = projectLabels
        .map(label => label.value)
        .filter(Boolean)
        .join(', ');
    return `Label(s) not found in project: ${unresolved.join(', ')}. Available labels: ${available || 'none'}`;
}
