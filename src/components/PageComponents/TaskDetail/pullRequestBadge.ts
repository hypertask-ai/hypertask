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
    color: "var(--color-pull-request-open)",
  },
  checks_red: {
    label: "Checks red",
    color: "var(--color-pull-request-checks-red)",
  },
  green: {
    label: "Checks green",
    color: "var(--color-pull-request-green)",
  },
  merged: {
    label: "Merged",
    color: "var(--color-pull-request-merged)",
  },
};
