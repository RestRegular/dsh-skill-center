/**
 * 离线复现 @deepseek-ai/dsh-client-modules 的合成校验:
 * 按 profile 的 dsh.profile.bundles 顺序读各包的 package.json,
 * 检查 dsh.client 声明、exports["./client"]、inject 提供方是否存在,
 * 以及客户端 bundle 的 id 是否与包名一致。
 *
 * 用途:在不动宿主进程的前提下确认 dsh-skill-center 的客户端半侧会被
 * 浏览器模块图接受(宿主侧的增量扫描由 loader 挂载事件驱动,见
 * dsh-client-modules/lib/index.js:527-540)。
 *
 * 运行: node verify-compose.mjs [profileDir]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const profileDir = process.argv[2] ?? 'C:/Users/32280/.dsh/profiles/desktop';
/** dsh 安装目录:随发行版交付的 bundle 从这里解析(Electron 的 asar 感知 fs 可直读)。 */
const installDir = process.env.DSH_INSTALL_DIR ?? 'D:/soft/dsh/resources/app.asar';
const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
const bundles = manifest.dsh?.profile?.bundles ?? [];

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined || ok ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

/** 读一个包:先在 profile 的 node_modules 找,再从 dsh 安装目录找。 */
function readPackage(name) {
  const candidates = [
    join(profileDir, 'node_modules', ...name.split('/')),
    join(installDir, 'dsh', 'node_modules', ...name.split('/')),
  ];
  for (const dir of candidates) {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) continue;
    try {
      return { dir, json: JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      /* 读到坏包继续找下一个 */
    }
  }
  return undefined;
}

/** 复现 clientExportOf:解析 exports["./client"] 到相对路径。 */
function clientExportOf(pkg) {
  const field = pkg.exports?.['./client'];
  if (typeof field === 'string') return field;
  if (field !== null && typeof field === 'object' && typeof field.default === 'string') return field.default;
  return undefined;
}

console.log(`== profile: ${profileDir} ==`);
console.log(`bundles: ${bundles.length}\n`);

/**
 * 收集候选包名:顶层 bundle + 每个 bundle 的 cordis.patch.yml 里声明的 loader 行
 * (随发行版交付的客户端包由 web-app 的 patch 层声明,不在 dsh.profile.bundles 里)。
 * @returns 去重后的包名数组。
 */
function collectCandidates() {
  const names = new Set(bundles);
  const patchFiles = [];
  for (const name of bundles) {
    const pkg = readPackage(name);
    if (pkg === undefined) continue;
    const declared = pkg.json.dsh?.bundle?.patch;
    const patchPath = join(pkg.dir, typeof declared === 'string' ? declared : 'cordis.patch.yml');
    if (existsSync(patchPath)) patchFiles.push(patchPath);
  }
  const profilePatch = join(profileDir, 'cordis.patch.yml');
  if (existsSync(profilePatch)) patchFiles.push(profilePatch);
  for (const file of patchFiles) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^\s*(?:-\s*)?name:\s*'([^']+)'/gm)) names.add(match[1]);
  }
  return [...names];
}

const roster = [];
for (const name of collectCandidates()) {
  if (name === 'cordis:group') continue;
  const pkg = readPackage(name);
  if (pkg === undefined) continue;
  const client = pkg.json.dsh?.client;
  if (client === undefined || client.platform !== 'web') continue;
  const bundlePath = clientExportOf(pkg.json);
  roster.push({ name, dir: pkg.dir, client, bundlePath });
  console.log(`  ok   ${name}: bundle=${bundlePath ?? '(缺失)'}`);
}

console.log(`\n== 客户端 roster: ${roster.length} 个 ==`);
const ids = new Set(roster.map((row) => row.name));

console.log('\n== dsh-skill-center 校验 ==');
const mine = roster.find((row) => row.name === 'dsh-skill-center');
check('在 roster 中(声明了 dsh.client.platform="web")', mine !== undefined);
if (mine !== undefined) {
  check('exports["./client"] 可解析', typeof mine.bundlePath === 'string', JSON.stringify(mine.bundlePath));
  const bundleFile = join(mine.dir, mine.bundlePath ?? '');
  check('客户端 bundle 文件存在', existsSync(bundleFile), bundleFile);
  if (existsSync(bundleFile)) {
    const source = readFileSync(bundleFile, 'utf8');
    const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(source);
    check('bundle 注册的 id 等于包名', idMatch?.[1] === 'dsh-skill-center', idMatch?.[1]);
    check('bundle 导出 apply/inject', /return\s*\{\s*apply,\s*inject\s*\}/.test(source) || /exports\.apply/.test(source));
  }
  for (const provider of mine.client.inject ?? []) {
    check(`dsh.client.inject 提供方存在: ${provider}`, ids.has(provider));
  }
  const entryFile = join(mine.dir, mine.json?.main ?? 'lib/index.js');
  check('宿主入口存在', existsSync(join(mine.dir, 'lib/index.js')), entryFile);
}

console.log(`\n${failures.length === 0 ? 'COMPOSE OK' : `FAILURES: ${failures.join(' | ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
