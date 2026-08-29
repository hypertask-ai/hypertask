"use client";
import { useSyncExternalStore } from "react";
import formatDateDifference from "@/utils/generateTime";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Renders formatDateDifference() only once hydration has finished.
 *
 * The string depends on the current time, the runtime timezone and the runtime
 * locale, so a UTC server and a visitor's browser disagree for anything older
 * than an hour ("24 Nov" vs "25 Nov", "6:42 AM" vs "3:42 PM"). React rejects the
 * mismatched text and regenerates the tree, which is the #418 seen on public
 * /share links (HTPR-4726). suppressHydrationWarning is the wrong tool here: it
 * silences the error but leaves the server's UTC value on screen.
 */
const RelativeTime = ({
  date,
  reminder,
}: {
  date: string | Date | null | undefined;
  reminder?: boolean;
}) => {
  const hydrated = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <>{hydrated ? formatDateDifference(date ?? null, reminder) : null}</>;
};

export default RelativeTime;
