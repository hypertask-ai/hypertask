import type { PullRequestDisplayState } from "@/lib/pullRequests/githubPullRequests";

interface PullRequestBadge {
  label: string;
  color: string;
  background: string;
}

export const pullRequestBadgeByState: Record<
  PullRequestDisplayState,
  PullRequestBadge
> = {
  open: {
    label: "Open",
    color: "#3fb950",
    background: "rgba(63,185,80,.12)",
  },
  checks_red: {
    label: "Checks red",
    color: "#f85149",
    background: "rgba(248,81,73,.12)",
  },
  green: {
    label: "Checks green",
    color: "#3fb950",
    background: "rgba(63,185,80,.12)",
  },
  merged: {
    label: "Merged",
    color: "#a371f7",
    background: "rgba(163,113,247,.12)",
  },
};
