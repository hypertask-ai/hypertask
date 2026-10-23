export function rememberLoadedModule<T>(load: () => Promise<T>) {
  let loaded: T | null = null;
  return {
    load: () => load().then((module) => (loaded = module)),
    loaded: () => loaded,
  };
}
