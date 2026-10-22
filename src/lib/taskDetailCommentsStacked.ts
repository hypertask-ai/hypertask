export function commentsStackedSetting({
  foldFromFirstPaint,
  preferencesLoaded,
  serverStacked,
  preferenceStacked,
}: {
  foldFromFirstPaint: boolean;
  preferencesLoaded: boolean;
  serverStacked: unknown;
  preferenceStacked: boolean;
}): boolean {
  if (foldFromFirstPaint && !preferencesLoaded && typeof serverStacked === "boolean") return serverStacked;
  return preferenceStacked;
}
