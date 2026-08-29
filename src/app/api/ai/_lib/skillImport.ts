import {
  parseSkillMarkdown,
  MAX_SKILL_BODY_BYTES,
  type ParsedSkillMarkdown,
} from "./skillMarkdown";

const MAX_IMPORT_SKILLS = 50;
// Bound the tree walk: a malicious/huge repo (e.g. the Linux kernel) must not be
// able to fan the unauthenticated GitHub API out indefinitely and burn the
// deployment's shared 60 req/hr limit or the function timeout.
const MAX_DIRS_VISITED = 200;
const MAX_WALK_DEPTH = 6;
const FETCH_TIMEOUT_MS = 10_000;
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Hypertask-Skills",
  "X-GitHub-Api-Version": "2022-11-28",
};

type ImportedSkill = ParsedSkillMarkdown & { sourceUrl: string };
type GitHubContent = {
  content?: string;
  download_url?: string | null;
  html_url?: string;
  name: string;
  path: string;
  type: "dir" | "file" | "symlink" | "submodule";
};

export async function importSkillsFromGitHub(input: string): Promise<ImportedSkill[]> {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("GitHub URL must use HTTPS");
  if (url.hostname !== "github.com" && url.hostname !== "raw.githubusercontent.com") {
    throw new Error("Only github.com and raw.githubusercontent.com URLs are allowed");
  }

  if (url.hostname === "raw.githubusercontent.com") {
    if (!url.pathname.endsWith("/SKILL.md")) {
      throw new Error("A raw GitHub URL must point to a SKILL.md file");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repo, ref, ...fileParts] = parts;
    if (!owner || !repo || !ref || fileParts.at(-1) !== "SKILL.md") {
      throw new Error("Raw GitHub SKILL.md URL is invalid");
    }
    const markdown = await fetchTextWithoutRedirect(url.toString());
    return [
      {
        ...parseSkillMarkdown(
          markdown,
          fileParts.length > 1 ? fileParts.at(-2) : repo
        ),
        sourceUrl: url.toString(),
      },
    ];
  }

  const target = parseGitHubUrl(url);
  const contents = await findSkillFiles(target);
  if (contents.length === 0) throw new Error("No SKILL.md files found");
  if (contents.length > MAX_IMPORT_SKILLS) {
    throw new Error(`Import contains more than ${MAX_IMPORT_SKILLS} skills`);
  }

  return Promise.all(
    contents.map(async (file) => {
      const markdown = await readGitHubFile(target.owner, target.repo, file, target.ref);
      return {
        ...parseSkillMarkdown(
          markdown,
          file.path.split("/").filter(Boolean).at(-2) || target.repo
        ),
        sourceUrl: file.html_url || file.download_url || input,
      };
    })
  );
}

function parseGitHubUrl(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, rawRepo, kind, ref, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo) throw new Error("GitHub repository URL is invalid");

  if (kind === "blob") {
    const path = rest.join("/");
    if (!ref || !path.endsWith("SKILL.md")) {
      throw new Error("GitHub file URL must point to a SKILL.md file");
    }
    return { owner, repo, ref, path, directFile: true };
  }
  if (kind === "tree") {
    if (!ref) throw new Error("GitHub folder URL is invalid");
    return { owner, repo, ref, path: rest.join("/"), directFile: false };
  }
  if (kind) throw new Error("Unsupported GitHub URL");
  return { owner, repo, ref: undefined, path: "", directFile: false };
}

async function findSkillFiles(target: ReturnType<typeof parseGitHubUrl>) {
  if (target.directFile) {
    const item = await fetchGitHubContents(target.owner, target.repo, target.path, target.ref);
    if (Array.isArray(item) || item.type !== "file") throw new Error("SKILL.md file not found");
    return [item];
  }

  const found: GitHubContent[] = [];
  const baseDepth = target.path.split("/").filter(Boolean).length;
  const directories: { path: string; depth: number }[] = [
    { path: target.path, depth: baseDepth },
  ];
  let visited = 0;
  while (directories.length > 0) {
    const dir = directories.shift();
    if (!dir) break;
    if (++visited > MAX_DIRS_VISITED) {
      throw new Error(
        `Repository is too large to scan (over ${MAX_DIRS_VISITED} folders). Point at the folder that holds your skills.`
      );
    }
    const listing = await fetchGitHubContents(target.owner, target.repo, dir.path, target.ref);
    const items = Array.isArray(listing) ? listing : [listing];
    for (const item of items) {
      if (item.type === "dir" && dir.depth < baseDepth + MAX_WALK_DEPTH) {
        directories.push({ path: item.path, depth: dir.depth + 1 });
      }
      if (item.type === "file" && item.name === "SKILL.md") found.push(item);
      if (found.length > MAX_IMPORT_SKILLS) return found;
    }
  }
  return found;
}

async function fetchGitHubContents(owner: string, repo: string, path: string, ref?: string) {
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const endpoint = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`
  );
  if (ref) endpoint.searchParams.set("ref", ref);
  const response = await fetch(endpoint, {
    headers: GITHUB_HEADERS,
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub import failed (${response.status})`);
  return (await response.json()) as GitHubContent | GitHubContent[];
}

async function readGitHubFile(owner: string, repo: string, file: GitHubContent, ref?: string) {
  const item = await fetchGitHubContents(owner, repo, file.path, ref);
  if (Array.isArray(item) || item.type !== "file" || !item.content) {
    throw new Error(`Could not read ${file.path}`);
  }
  return Buffer.from(item.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchTextWithoutRedirect(url: string) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("GitHub redirects are not allowed");
  }
  if (!response.ok) throw new Error(`GitHub import failed (${response.status})`);
  // Cap before buffering: a raw.githubusercontent.com URL can point at any file
  // size, and the 64KB body limit is otherwise only checked after the whole
  // response is read into memory.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SKILL_BODY_BYTES) {
    throw new Error("SKILL.md file exceeds the 64KB body limit");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_BODY_BYTES) {
    throw new Error("SKILL.md file exceeds the 64KB body limit");
  }
  return text;
}
