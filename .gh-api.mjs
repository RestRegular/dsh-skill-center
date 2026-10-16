// GitHub REST helper — runs *inside* `devcred inject`, so GITHUB_TOKEN comes from the
// injected environment and is never passed on a command line. It prints only
// non-secret results (login, status, repo URLs) and lets devcred redact the rest.
import { readFileSync } from 'node:fs';

const [, , action, arg] = process.argv;
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is not present — run this through `devcred inject --only github-agent-use`.');
  process.exit(2);
}

const API = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-skill-center-release',
};

async function call(path, init = {}) {
  const response = await fetch(API + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const actions = {
  async whoami() {
    const { status, body } = await call('/user');
    console.log(`whoami: status=${status} login=${body?.login} id=${body?.id}`);
    return status === 200;
  },

  async 'create-repo'() {
    const payload = JSON.parse(readFileSync(arg, 'utf8'));
    const created = await call('/user/repos', { method: 'POST', body: JSON.stringify(payload) });
    if (created.status === 201) {
      console.log(`created: ${created.body.full_name} (private=${created.body.private})`);
      console.log(`clone:   ${created.body.clone_url}`);
      return true;
    }
    if (created.status === 422) {
      // Already exists (e.g. a retry) — treat as success and report the existing repo.
      const existing = await call(`/repos/${payload.name}`);
      if (existing.status === 200) {
        console.log(`exists:  ${existing.body.full_name} (private=${existing.body.private})`);
        console.log(`clone:   ${existing.body.clone_url}`);
        return true;
      }
    }
    console.error(`create-repo failed: status=${created.status} ${JSON.stringify(created.body)}`);
    return false;
  },
};

const handler = actions[action];
if (!handler) {
  console.error(`unknown action: ${action}`);
  process.exitCode = 2;
} else {
  try {
    // Set the code instead of calling process.exit(): forcing an exit while the fetch
    // keep-alive socket is still closing trips a libuv assertion on Windows.
    process.exitCode = (await handler()) ? 0 : 1;
  } catch (error) {
    console.error(`helper error: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
