export function railSectionShut(
  enabled: boolean,
  title: string,
  collapsed: readonly string[],
  searching: boolean,
) {
  return enabled && !searching && collapsed.includes(title);
}
