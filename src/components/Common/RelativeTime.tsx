"use client";
import { useSyncExternalStore } from "react";
import formatDateDifference from "@/utils/generateTime";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

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
