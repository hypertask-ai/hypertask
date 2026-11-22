const INJECTED_WALLET_EXCEPTION = /window\.ethereum\b|['"]selectedAddress['"]/;

export function isInjectedWalletExceptionMessage(message) {
  return typeof message === "string" && INJECTED_WALLET_EXCEPTION.test(message);
}

export function dropInjectedWalletException(event) {
  if (!event || event.event !== "$exception") return event;
  const exceptions = event.properties?.$exception_list;
  if (
    Array.isArray(exceptions) &&
    exceptions.length > 0 &&
    exceptions.every((entry) => isInjectedWalletExceptionMessage(entry?.value))
  ) {
    return null;
  }
  return event;
}
