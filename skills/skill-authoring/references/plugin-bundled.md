# Shipping skills inside a plugin

A plugin that owns a workflow should publish the skill with the code it describes, not copy files into the user's roots: the package versions both together, and every session in the profile sees the same instructions. The host half needs only `skills` in its `inject` list.

## Provider registration (recommended)

`ctx.skills.registerProvider()` registers a catalog of skills that live in this package's own asset directory. Candidates are validated by the registry before they are cached, and each one can carry a `resourceBase` that tells the model where its resource files are.

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const NAME = 'my-skill';
const ROOT = fileURLToPath(new URL('../skills/', import.meta.url)); // package assets
const RANK_BUNDLED = 600; // @deepseek-ai/dsh-skill BUNDLED_SKILL_RANK

export function apply(ctx) {
  const directory = join(ROOT, NAME);
  const path = join(directory, 'SKILL.md');
  const raw = readFileSync(path, 'utf8');
  const description = /* parse frontmatter, require a non-empty description */;
  const candidate = {
    name: NAME,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'my-plugin',        // must equal the provider's name
    source: 'bundled',
    rank: RANK_BUNDLED,
    resourceBase: { kind: 'directory', path: directory },
    locator: path,                // opaque; handed back to get()
    path,                         // shown by discovery consumers such as this panel
  };
  ctx.effect(() => ctx.skills.registerProvider(() => ({
    name: 'my-plugin',
    list: () => Promise.resolve([candidate]),
    async get(winner, options) {
      const { rank, locator, ...summary } = winner;
      return { ...summary, content: /* body after the frontmatter */ };
    },
  })), 'my-plugin: skill provider');
}
```

Rules the registry enforces:

- `provider` on every candidate must equal the provider's own `name`; two providers in one layer may not share a name, and `runtime` is reserved.
- `name` must be kebab-case, `description` non-empty, `invocation` exactly two booleans, `rank` a finite number, `source` a string. One malformed candidate fails the whole observation, so validate while building the list, not inside `get()`.
- `list()` returns an array, or `{ candidates, complete: false }` when discovery was partial. Read files inside `get()` — **bodies are never cached**, so re-reading keeps edits visible; only the catalog is cached until you call the `invalidate()` handed to the provider factory.
- `get()` must return the selected candidate's `name` unchanged. A mismatch makes the registry drop its cached catalogs.
- Register inside `ctx.effect(...)` so disposal removes the provider and invalidates the catalog when the plugin reloads.

`resourceBase: { kind: 'directory', path }` is what makes the skill's resources usable: the model receives that absolute directory and is told to resolve relative paths against it. Without it the hint degrades to "resources are managed by provider X" and a resource-referencing skill becomes unusable.

## Runtime registration (in-memory)

`ctx.skills.register(skill)` inserts one in-memory skill into the calling context's layer, labelled with the reserved `runtime` provider and rank 250. It is the right tool when the instructions are generated per deployment (paths, versions, feature flags) rather than shipped as files:

```js
ctx.skills.register({
  name: 'deployment-notes',
  description: 'Use when …',
  source: 'generated',
  content: '# Deployment\n\n' + generatedBody,
  invocation: { modelInvocable: true, userInvocable: true },
});
```

`register()` takes the **definition**, not a candidate: `content` is required, `source` is required, and the object itself is handed back as the loaded definition. It accepts anything the provider form accepts except `rank`, `locator` and `get()`. Prefer a provider whenever the skill refers to resource files.

## Bundle-provided root

A profile bundle can instead add a plain directory root to the filesystem provider with a patch row, which buys the watcher and needs no provider code:

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    bundledSkillDir: '<absolute directory holding <name>/SKILL.md bundles>'
```

That row scans the directory at rank 600 (`$DSH_BUNDLED_SKILL_DIR` is the default when the field is absent). It is a single directory, it is only configurable from the profile patch, and it cannot express a URL or opaque resource base.

## Consequences to state in the package README

- **Read-only.** Such skills live outside the managed roots, so the Skill Center panel lists them as *embedded*: invocation switches, editing and deletion are disabled. That is intentional — the package owns them.
- **Rank 600.** Any project or user skill with the same name shadows it, which is how a user overrides a shipped workflow.
- **`app.asar`.** In the desktop build a bundled package may live inside `app.asar`; the Host side reads those paths fine, but shell commands, `glob`, `grep`, `node` and package managers cannot. Skills that tell the model to *run* a bundled script must say to copy it into the workspace first.
- **Frontmatter is parsed twice.** The provider reads the description for the catalog and the body for the load; keep one parser for both so the two can never disagree.
