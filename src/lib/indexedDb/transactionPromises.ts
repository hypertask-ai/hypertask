const abortReason = (transaction: IDBTransaction): DOMException | Error =>
  transaction.error ?? new Error("IndexedDB transaction aborted");

export const waitForTransaction = (transaction: IDBTransaction): Promise<void> => {
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(abortReason(transaction));
  });
  completion.catch(() => undefined);
  return completion;
};

export const requestValue = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
