export type DictationLease = symbol;

export interface DictationCoordinator {
  acquire: () => DictationLease | null;
  owns: (lease: DictationLease) => boolean;
  release: (lease: DictationLease) => boolean;
}

export function createDictationCoordinator(
  onBusyChange: (busy: boolean) => void,
): DictationCoordinator {
  let owner: DictationLease | null = null;

  return {
    acquire() {
      if (owner) return null;
      owner = Symbol("dictation");
      onBusyChange(true);
      return owner;
    },
    owns(lease) {
      return owner === lease;
    },
    release(lease) {
      if (owner !== lease) return false;
      owner = null;
      onBusyChange(false);
      return true;
    },
  };
}
