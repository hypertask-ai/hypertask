import { Metadata } from "next";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import TimeComp from "./TimeComp";

export const metadata: Metadata = {
  title: "Time",
};

export default async function TimePage() {
  await requireServerCookieUser();
  return <TimeComp />;
}
