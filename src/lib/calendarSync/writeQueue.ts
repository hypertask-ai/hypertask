export const createSerializedLatestWriteQueue = () => {
  const tails = new Map<string, Promise<void>>();
  const versions = new Map<string, number>();

  return {
    enqueue: <T>(key: string, operation: () => Promise<T>): Promise<T | null> => {
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous
        .catch(() => undefined)
        .then(() =>
          versions.get(key) === version ? operation() : Promise.resolve(null),
        );
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.finally(() => {
        if (tails.get(key) !== tail) return;
        tails.delete(key);
        if (versions.get(key) === version) versions.delete(key);
      });
      return run;
    },
    enqueueMaintenance: <T>(
      key: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(operation);
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.finally(() => {
        if (tails.get(key) !== tail) return;
        tails.delete(key);
        versions.delete(key);
      });
      return run;
    },
  };
};
