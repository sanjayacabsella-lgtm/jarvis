export type GitHubReadRequest = {
  repo: string;
  includeReadme?: boolean;
  includePrs?: boolean;
  includeIssues?: boolean;
  includeCommits?: boolean;
  includeActions?: boolean;
};

type GitHubRepo = {
  full_name: string;
  default_branch: string;
  html_url: string;
  description: string | null;
  updated_at: string;
  pushed_at: string;
  open_issues_count: number;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  visibility?: string;
};

type GitHubCommit = {
  sha: string;
  commit: {
    message: string;
    author: { date: string; name: string } | null;
  };
  html_url?: string;
};

type GitHubIssue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user?: { login: string } | null;
  pull_request?: Record<string, never>;
};

type GitHubPr = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user?: { login: string } | null;
  created_at: string;
};

type GitHubActionRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
};

function normalizeRepo(input: string): string {
  const value = input.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("Repo must be in the format owner/name.");
  }
  return value;
}

function decodeReadme(content: string): string {
  const raw = Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
  return raw.slice(0, 1500);
}

async function githubFetch<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jarvis-github-read",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`https://api.github.com${path}`, {
    headers,
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${details.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

export async function fetchGitHubReadData(input: GitHubReadRequest) {
  const repo = normalizeRepo(input.repo);

  const [repoData, latestCommit, openPrs, openIssues, actionRuns] = await Promise.all([
    githubFetch<GitHubRepo>(`/repos/${repo}`),
    githubFetch<GitHubCommit[]>(`/repos/${repo}/commits?per_page=1`),
    githubFetch<GitHubPr[]>(`/repos/${repo}/pulls?state=open&per_page=5`),
    githubFetch<GitHubIssue[]>(`/repos/${repo}/issues?state=open&per_page=5`),
    githubFetch<{ workflow_runs: GitHubActionRun[] }>(`/repos/${repo}/actions/runs?per_page=5`),
  ]);

  const readme = input.includeReadme
    ? await githubFetch<{ content?: string }>(`/repos/${repo}/readme`)
        .then((data) => (data.content ? decodeReadme(data.content) : null))
        .catch(() => null)
    : null;

  const recentPrs = openPrs.slice(0, 5).map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: pr.user?.login ?? "unknown",
    url: pr.html_url,
  }));

  const recentIssues = openIssues
    .filter((issue) => !issue.pull_request)
    .slice(0, 5)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.user?.login ?? "unknown",
      url: issue.html_url,
    }));

  const recentActions = (actionRuns.workflow_runs ?? []).slice(0, 5).map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    url: run.html_url,
  }));

  const commit = latestCommit[0];
  const summary = [
    `Repository ${repo}.`,
    `Default branch: ${repoData.default_branch}.`,
    `Last pushed: ${repoData.pushed_at}.`,
    `Open PRs: ${recentPrs.length}.`,
    `Open issues: ${recentIssues.length}.`,
    commit ? `Latest commit: ${commit.sha.slice(0, 7)} — ${commit.commit.message.split("\n")[0]}.` : "No commit metadata available.",
  ].join(" ");

  return {
    repo,
    summary,
    metadata: {
      fullName: repoData.full_name,
      defaultBranch: repoData.default_branch,
      description: repoData.description,
      htmlUrl: repoData.html_url,
      language: repoData.language,
      visibility: repoData.visibility ?? "public",
      updatedAt: repoData.updated_at,
      pushedAt: repoData.pushed_at,
      openIssuesCount: repoData.open_issues_count,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
    },
    latestCommit: commit
      ? {
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 7),
          message: commit.commit.message.split("\n")[0],
          author: commit.commit.author?.name ?? "unknown",
          date: commit.commit.author?.date ?? null,
          url: commit.html_url ?? `${repoData.html_url}/commit/${commit.sha}`,
        }
      : null,
    prs: recentPrs,
    issues: recentIssues,
    actions: recentActions,
    readme: input.includeReadme ? readme : null,
  };
}

