import type { PullRequestDisplayState } from "@/lib/pullRequests/githubPullRequests";

interface PullRequestBadge {
  label: string;
  color: string;
}

export const pullRequestBadgeByState: Record<
  PullRequestDisplayState,
  PullRequestBadge
> = {
  open: {
    label: "Open",
    color: "#3fb950",
  },
  checks_red: {
    label: "Checks red",
    color: "#f85149",
  },
  green: {
    label: "Checks green",
    color: "#3fb950",
  },
  merged: {
    label: "Merged",
    color: "#a371f7",
  },
};
