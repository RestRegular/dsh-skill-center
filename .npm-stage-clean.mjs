// Clean up staged npm publishes: list every staged version, reject the ones matching the
// requested package (optionally only a specific version), then report what is left.
// Runs inside `devcred inject`, so NPM_TOKEN comes from the injected environment.
const token = process.env.NPM_TOKEN;
if (!token) {
  console.error('NPM_TOKEN missing — run through `devcred inject --only npm-agent-use`.');
  process.exitCode = 2;
} else {
  const [, , pkgArg, onlyVersion] = process.argv;
  const target = pkgArg ?? '@restregular/dsh-skill-center';
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'dsh-skill-center-release',
  };

  const list = await fetch('https://registry.npmjs.org/-/stage', { headers });
  const body = await list.json();
  const items = body.items ?? [];
  console.log(`staged entries: ${items.length} (total ${body.total ?? '?'})`);

  const mine = items.filter((item) => {
    const name = item.package?.name ?? item.name ?? item.pkg ?? '';
    const version = item.package?.version ?? item.version ?? '';
    const matches = name === target && (onlyVersion === undefined || version === onlyVersion);
    console.log(`  - ${name}@${version} stageId=${item.stageId ?? item.id} tag=${item.tag ?? '-'}`);
    return matches;
  });

  for (const item of mine) {
    const stageId = item.stageId ?? item.id;
    const response = await fetch(`https://registry.npmjs.org/-/stage/${stageId}`, {
      method: 'DELETE',
      headers,
    });
    const text = await response.text();
    console.log(`reject ${stageId}: ${response.status} ${text.slice(0, 200)}`);
  }

  const after = await fetch('https://registry.npmjs.org/-/stage', { headers });
  const afterBody = await after.json();
  console.log(`staged entries after cleanup: ${(afterBody.items ?? []).length}`);
}
