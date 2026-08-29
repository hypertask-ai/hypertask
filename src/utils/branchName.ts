const MAX_BRANCH_SLUG_LENGTH = 50;

export const buildBranchName = (ticketNumber: string, title: string) => {
  const ticket = ticketNumber.trim().toLowerCase();
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BRANCH_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return [ticket, slug].filter(Boolean).join("-");
};
