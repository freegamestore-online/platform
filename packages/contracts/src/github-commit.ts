export interface CommitOptions {
  org: string;
  repo: string;
  token: string;
  files: Record<string, string>;
  deletions?: string[];
  message: string;
  /** Encoding for file content: "utf-8" or "base64". Defaults to "utf-8". */
  encoding?: 'utf-8' | 'base64';
  /** If true, replace the entire tree instead of merging with base_tree. Defaults to false. */
  replaceTree?: boolean;
}

export interface CommitResult {
  sha: string;
  deletedCount: number;
}

/** Helper function to commit files to a GitHub repo via Git Data API.
 *  Returns the commit SHA and count of files actually deleted. Supports file deletions. */
export async function commitFiles(options: CommitOptions): Promise<CommitResult> {
  const {
    org,
    repo,
    token,
    files,
    deletions = [],
    message,
    encoding = 'utf-8',
    replaceTree = false,
  } = options;
  const base = `https://api.github.com/repos/${org}/${repo}`;

  async function gh(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : null,
    });
    // GitHub API responses are dynamic; we allow property access without strict typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return res.json() as Promise<any>;
  }

  let parentSha: string | undefined;
  let baseTree: string | undefined;
  const ref = await gh(`/git/ref/heads/main`);
  if (ref?.object?.sha) {
    parentSha = ref.object.sha;
    const parent = await gh(`/git/commits/${parentSha}`);
    baseTree = parent?.tree?.sha;
  } else {
    // Empty repo — Git Data API needs a commit to exist. Seed via Contents API.
    const seed = await gh(`/contents/.gitkeep`, 'PUT', {
      message: 'seed',
      content: '',
    });
    if (!seed?.commit?.sha) throw new Error(`repo seed failed: ${seed.message}`);
    parentSha = seed.commit.sha;
    const parent = await gh(`/git/commits/${parentSha}`);
    baseTree = parent?.tree?.sha;
  }

  const treeItems: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await gh(`/git/blobs`, 'POST', {
      content,
      encoding,
    });
    if (!blob?.sha) throw new Error(`blob create failed for ${path}: ${blob.message}`);
    treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // Handle deletions
  const pending = [...new Set(deletions)].filter((path) => !Object.hasOwn(files, path));
  let deletedCount = 0;
  if (pending.length > 0 && baseTree) {
    let base: { tree?: unknown; truncated?: boolean; message?: string };
    try {
      base = await gh(`/git/trees/${baseTree}?recursive=1`);
    } catch (err) {
      base = { message: String(err) };
    }
    if (!Array.isArray(base.tree) || base.truncated) {
      throw new Error(
        `could not read the repo tree to apply file deletions: ${base.message || 'tree unavailable or truncated'}`,
      );
    }
    const present = new Set(
      (base.tree as { path?: string; type?: string }[])
        .filter((e) => e.type === 'blob')
        .map((e) => e.path),
    );
    for (const path of pending) {
      if (!present.has(path)) continue;
      treeItems.push({ path, mode: '100644', type: 'blob', sha: null });
      deletedCount++;
    }
  }

  const tree = await gh(`/git/trees`, 'POST', {
    ...(replaceTree ? {} : { base_tree: baseTree }),
    tree: treeItems,
  });
  if (!tree?.sha) throw new Error(`tree create failed: ${tree.message}`);

  const commit = await gh(`/git/commits`, 'POST', {
    message,
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
  });
  if (!commit?.sha) throw new Error(`commit create failed: ${commit.message}`);

  const upd = await gh(`/git/refs/heads/main`, 'PATCH', { sha: commit.sha });
  if (!upd?.ref) throw new Error(`ref update failed: ${upd.message}`);
  return { sha: commit.sha, deletedCount };
}
