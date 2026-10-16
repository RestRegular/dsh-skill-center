---
name: skill-authoring
description: "Use when creating, editing, moving, or reviewing a Harness skill: choosing the skill root for project or user scope, writing SKILL.md frontmatter and body, placing the skill's resource files next to it, or shipping a skill inside a plugin."
---

# Authoring Harness skills

A skill is a **directory bundle**: `<root>/<name>/SKILL.md` plus every resource file that `SKILL.md` refers to. The model sees only each skill's `name` and `description` in the session catalog; the body is loaded on demand when the model or the user invokes it, and resource files are never loaded automatically. A skill's body must therefore say which file to read and when.

## Short path

1. Pick the root — see `references/roots.md`. Project-scoped skill: `<projectRoot>/.agents/skills`. Available in every project: `$DSH_AGENTS_HOME/skills` (`~/.agents/skills`).
2. Create `<root>/<name>/SKILL.md`. `name` is kebab-case and should equal the directory name.
3. Keep the frontmatter minimal: `name` and `description` are required; the body starts after the closing `---`.
4. Put resource files in subdirectories of **that same bundle directory** and point at them with relative paths.
5. Verify: the frontmatter parses, `name` matches the directory, every referenced file exists, and the skill appears in the Skill Center panel (and in the catalog of the next model step).

Use the `skill_create` tool when the target root is outside the current workspace: the file-write tools are sandboxed to the workspace, while the managed skill roots are not, so a direct write to `~/.agents/skills/...` is denied. `skill_create` writes `<root>/<name>/SKILL.md` plus any `resources` you pass, in one call, and returns the absolute bundle directory. Inside the workspace (for example `<projectRoot>/.agents/skills`) ordinary file writes work fine.

## Frontmatter decides who can invoke the skill

| Field | Effect |
|---|---|
| `description` | the only routing signal in the catalog — write it as "Use when …" and name the tasks, not the implementation |
| `disable-model-invocation: true` | the skill leaves the model catalog entirely; only an explicit `/name` from the user loads it |
| `user-invocable: false` | `/name` stops working for humans; the model can still load the skill |

The camelCase spellings (`disableModelInvocation`, `modelInvocable`, `userInvocable`) are **rejected**: a skill carrying one is skipped with a warning instead of loading. The full contract, the accepted boolean spellings, and the silent failure modes are in `references/frontmatter.md`.

## Resource placement

Everything a skill needs lives under its own bundle directory, because the base directory reported to the model *is* that directory and relative paths resolve against it:

```
<root>/<name>/
  SKILL.md
  references/   long-form detail the body points at by relative path
  scripts/      commands the body tells the model to run
  assets/       fixtures, templates, images
```

The loaded skill arrives wrapped in `<skill_content>` with a `<skill_resources>` block that names the absolute base directory; the model is told to resolve relative paths against it before reading. Files under a bundle's resource subtrees are read directly by the file tools when the body asks for them, so editing a reference file needs no catalog refresh — only the skill *list* (names, descriptions, invocation policy) is cached. Details, path rules and the Desktop `app.asar` caveat: `references/resources.md`.

## Shipping a skill inside a plugin

A plugin publishes its own skills instead of writing into the user's roots: it registers a skill provider (or a runtime skill) and points each candidate at an asset directory inside the package. Use this when the skill's instructions and resources must version together with the code they describe. `references/plugin-bundled.md` has the provider contract, the candidate fields, the rank, and the two registration APIs.

## Read next

Read only the files this task needs; the table is complete.

| Task | File |
|---|---|
| Which root a skill belongs in, root precedence, project-root detection | `references/roots.md` |
| Frontmatter fields, validation, and why a skill silently does not load | `references/frontmatter.md` |
| Where resource files go, how the model is told to find them, Desktop limits | `references/resources.md` |
| Shipping skill instructions and resources inside a plugin package | `references/plugin-bundled.md` |
| Starter bundle for a new skill | `templates/minimal/SKILL.md` |
