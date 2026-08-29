export interface ParsedSlackCommand {
  args: { _: string; [key: string]: string };
  subcommand: string;
}

export function parseSlackCommand(text: string): ParsedSlackCommand {
  const tokens = tokenize(text.trim());
  if (tokens.length === 0) return { subcommand: "help", args: { _: "" } };

  const [subcommandToken, ...rest] = tokens;
  const args: { _: string; [key: string]: string } = { _: "" };
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith("--")) {
      const key = token.slice(2).toLowerCase();
      const next = rest[index + 1];
      args[key] = next && !next.startsWith("--") ? rest[++index] : "true";
    } else {
      positional.push(token);
    }
  }
  args._ = positional.join(" ");
  return { subcommand: subcommandToken.toLowerCase(), args };
}

export const SLACK_HELP_TEXT = `*Hypertask — Commands*

\`/ht connect\` — Link your Hypertask account
\`/ht disconnect\` — Unlink your account
\`/ht create <title> --project X [--priority X] [--assign X] [--label X] [--section X] [--description X]\` — Create task
\`/ht search <query> [--project X]\` — Search tasks
\`/ht list [--project X] [--status X] [--assignee X] [--section X] [--priority X]\` — List tasks
\`/ht view <ticket>\` — View task details
\`/ht comment <ticket> <text>\` — Add comment
\`/ht assign <ticket> <user>\` — Assign user
\`/ht move <ticket> <section>\` — Move task to section
\`/ht update <ticket> [--title X] [--priority X] [--status X] [--description X]\` — Update task
\`/ht inbox\` — Show notifications
\`/ht projects\` — List projects
\`/ht help\` — Show this help

Or mention *@Hypertask* with natural language.`;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+)/g;
  for (const match of input.matchAll(pattern)) {
    tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\([\\"'])/g, "$1"));
  }
  return tokens;
}
