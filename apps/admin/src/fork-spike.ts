/**
 * SPIKE / PROOF OF CONCEPT ONLY — deliberately not imported by publish.ts or
 * any production provisioning route.
 *
 * This models a whole-repository Remix using GitHub's fork endpoint. Its
 * completeness check compares the source and fork default-branch commit SHAs;
 * it never enumerates, copies, or caps individual files.
 */

export interface ForkRepoOptions {
  /** Token with permission to fork into targetOrg. Required by the live API. */
  token: string;
  /** Injectable only to make this bounded spike deterministic in tests. */
  fetchImpl?: typeof fetch;
  /** Overridable for tests; production GitHub uses the default. */
  apiBaseUrl?: string;
}

export interface ForkResult {
  sourceFullName: string;
  forkFullName: string;
  branch: string;
  sourceSha: string;
  forkSha: string;
}

interface GitHubRepo {
  full_name?: string;
  default_branch?: string;
  message?: string;
}

interface GitHubCommit {
  sha?: string;
  message?: string;
}

function repoPath(fullName: string): string {
  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Expected GitHub repository in owner/repo form, received ${fullName}`);
  }
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}

async function githubJson<T>(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetchImpl(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(
      `GitHub ${method} ${path} failed (${response.status}): ${payload.message ?? 'unknown error'}`,
    );
  }
  return payload;
}

/**
 * Fork a complete source repository into an organisation and verify it has the
 * same default-branch commit as the source. This is intentionally an isolated
 * spike: callers must explicitly supply a token and it is not production-wired.
 */
export async function forkRepo(
  sourceFullName: string,
  targetOrg: string,
  newRepoName: string,
  options: ForkRepoOptions,
): Promise<ForkResult> {
  if (!targetOrg || !newRepoName) throw new Error('targetOrg and newRepoName are required');

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
  const sourcePath = repoPath(sourceFullName);
  const fork = await githubJson<GitHubRepo>(
    fetchImpl,
    apiBaseUrl,
    options.token,
    `/repos/${sourcePath}/forks`,
    'POST',
    {
      organization: targetOrg,
      name: newRepoName,
    },
  );
  const forkFullName = fork.full_name ?? `${targetOrg}/${newRepoName}`;
  const branch = fork.default_branch ?? 'main';

  const sourceCommit = await githubJson<GitHubCommit>(
    fetchImpl,
    apiBaseUrl,
    options.token,
    `/repos/${sourcePath}/commits/${encodeURIComponent(branch)}`,
  );
  const forkCommit = await githubJson<GitHubCommit>(
    fetchImpl,
    apiBaseUrl,
    options.token,
    `/repos/${repoPath(forkFullName)}/commits/${encodeURIComponent(branch)}`,
  );
  if (!sourceCommit.sha || !forkCommit.sha) {
    throw new Error('GitHub did not return a commit SHA for the source or fork default branch');
  }
  if (sourceCommit.sha !== forkCommit.sha) {
    throw new Error(
      `Fork completeness check failed: ${sourceFullName}@${sourceCommit.sha} != ${forkFullName}@${forkCommit.sha}`,
    );
  }

  return {
    sourceFullName,
    forkFullName,
    branch,
    sourceSha: sourceCommit.sha,
    forkSha: forkCommit.sha,
  };
}
