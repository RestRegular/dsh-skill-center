# Skill resources

## How the model is told where they are

When a skill is loaded, the body is rendered inside `<skill_content>` together with a `<skill_resources>` block that carries the base location:

| Provider sets | `<skill_resources>` says |
|---|---|
| `resourceBase: { kind: 'directory', path }` | `Base directory for this skill: <path>` — "Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed." |
| `resourceBase: { kind: 'url', url }` | `Base URL for this skill: <url>` |
| `resourceBase: { kind: 'opaque', description }` | `Resources for this skill: <description>` |
| nothing | "Resources for this skill are managed by provider …" |

For every filesystem skill the base directory is the **bundle directory** (`<root>/<name>/`); for the flat `<name>.md` form it is the whole root. Resources are a *hint*, not an attachment: nothing lists the directory and nothing fetches a referenced file. The body has to name the file and say when to read it.

## Layout

```
<root>/<name>/
  SKILL.md          routing + the workflow itself
  references/       detail too long for the body: contracts, tables, edge cases
  scripts/          commands the body tells the model to run
  assets/           fixtures, images, sample data
  templates/        files meant to be copied into the workspace
```

These names are a convention, not a requirement — only the paths your `SKILL.md` actually mentions matter. Keep them stable: a renamed reference breaks every body that points at it.

## Path rules

- Write paths **relative to the base directory** (`references/api.md`, `scripts/check.py`). Never write an absolute path into a skill: the root differs per machine and per install.
- Never rely on the working directory. A skill loads in whatever cwd the session has; the base directory is the only stable anchor.
- Do not reference files outside the bundle directory. A resource in the workspace, another skill, or `$DSH_HOME` may be absent at load time, and the base directory is the one location the model is told to trust.
- For a script, spell out how to run it: interpreter first, absolute path built from the base directory, and the expected cwd. On Windows the shell is PowerShell; `python`/`node` availability differs per host, so state the interpreter explicitly and prefer a command that fails loudly over one that silently does nothing.
- Keep scripts side-effect-free or clearly gated: a skill body is followed by a model that will run what it says.

## Size and cost

- A loaded body has **no size cap** — everything in `SKILL.md` lands in context on every load. Keep it to routing plus the workflow, and push long-form detail into `references/` files that the body names one by one.
- Reference files cost nothing until read, so favor several focused files over one large one, and say in the body when each is needed ("read `references/roots.md` before choosing a directory").
- The catalog shows only `description` (truncated to the configured limit, 500 characters by default), so a long description buys nothing beyond the first sentence or two.

## Writing resources

- Agent file-write tools are sandboxed to the session workspace, so a resource that belongs in a user-level root (`~/.agents/skills/…`) cannot be written with them. Use the `skill_create` tool's `resources` argument (a Host-side write confined to managed roots), or ask for approval.
- Editing or adding a resource file under an existing bundle does **not** change the catalog and needs no refresh — resource files are read directly by the file tools when the body asks for them. Adding a whole new skill bundle *is* a catalog change.
- Keep the plugin's write guard in mind: `skill_create` only writes inside `<root>/<name>/` and rejects absolute paths, `..` segments and a second `SKILL.md`, so resources cannot be smuggled out of the bundle.

## Desktop caveat

Skills shipped inside a plugin that lives in `app.asar` (the first-party Office skills, for example) sit on a path that only the Host process's own file reads can open. Shell commands, the glob and search tools, `node` and package managers all fail on `app.asar` paths — copy such a file into the workspace with the file-read/file-write tools before running anything against it. Skills under the user and project roots are ordinary files with no such limit.
