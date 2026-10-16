# Where skills live

Local skills are discovered by `@deepseek-ai/dsh-skill-filesystem`. It scans a fixed list of **roots** and, in each root, only that root's **direct children**: a directory bundle `<name>/SKILL.md`, or a flat file `<name>.md`. Nested `**/SKILL.md` search is deliberately unsupported, so a skill inside `assets/` or `templates/` of another skill is never discovered.

## The root table

`<projectRoot>` is the nearest ancestor of the session's working directory that contains `.git`; if no ancestor has one, the working directory itself is the project root.

| Rank | Source id | Path | Scope |
|---|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` | this project |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` | this project |
| 250 | `runtime` | in-memory (`ctx.skills.register()`) | plugin-provided |
| 300 | `custom` | profile `customSkillDirs` entries | deployment |
| 400 | `user-dsh` | `$DSH_HOME/skills` (`~/.dsh/skills`) | all projects |
| 500 | `user-agents` | `$DSH_AGENTS_HOME/skills` (`~/.agents/skills`) | all projects |
| 600 | `bundled` | `bundledSkillDir` / `$DSH_BUNDLED_SKILL_DIR` | shipped with the app or a plugin |

`$DSH_HOME` defaults to `~/.dsh` and `$DSH_AGENTS_HOME` to `~/.agents`; both can be overridden by the environment. The `.system` subdirectory of `$DSH_HOME/skills` is skipped.

## Choosing a root

- **Project-specific workflow** (build/test/release steps of one repository): `<projectRoot>/.agents/skills`. It travels with the repository; `<projectRoot>/.dsh/skills` has the same scope and outranks it.
- **Reusable across projects**: `$DSH_AGENTS_HOME/skills` (`~/.agents/skills`). This is what the Skill Center panel and `skill_create` use by default.
- **Personal Harness-only workflow**: `$DSH_HOME/skills` (`~/.dsh/skills`).
- Never hand-write into `custom` or `bundled` roots: they belong to the deployment and the package that ships them.

Only the four roots marked `project-dsh`, `project-agents`, `user-dsh` and `user-agents` are **managed** by this plugin: the panel and `skill_create` may create and write there, and every write is confined to a root that exists on disk (or to a user root, which they create). A skill that lives anywhere else — inside a plugin package, a `custom` directory, or under a `bundled` root — is listed as **embedded** and read-only.

## Precedence

One name resolves to exactly one skill:

1. **Layer first.** The registry keeps a host layer plus one layer per agent-preset scope; the nearest layer wins outright, so a preset-mounted repository plugin can shadow a host skill.
2. **Rank second**, within one layer: the lowest rank wins, which is why a project skill shadows a user skill of the same name and both shadow a `bundled` one.
3. Registration order, then provider-local order break the remaining ties.

Shadowed duplicates are logged and hidden; there is no API that lists them. If an edit seems to have no effect, check for a same-named skill in a nearer layer or a lower rank — that is the usual cause.

## Presence and refresh

- A root that does not exist yet is simply empty; missing roots are polled until they appear, so creating `~/.agents/skills` later still works without a restart.
- Discovered skills are re-read on every load, but the *catalog* (names, descriptions, invocation policy) is cached per workspace and only refreshes when the provider invalidates it: adding, renaming or deleting a bundle, a flat `<name>.md`, or a direct `SKILL.md` triggers that invalidation. Changes under a bundle's resource subtrees do not.
- A skill present on disk but not in the catalog is usually invalid frontmatter, not a caching problem — see `frontmatter.md`.
