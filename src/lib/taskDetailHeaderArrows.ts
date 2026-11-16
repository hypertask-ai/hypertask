export function ticketUpDownLivesInHeader(enabled: boolean, mobile: boolean, embedded: boolean): boolean {
  return enabled && !mobile && !embedded;
}
