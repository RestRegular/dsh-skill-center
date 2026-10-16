# The SKILL.md contract

## File shape

```markdown
---
name: my-skill
description: "Use when …"
---

# Body

Instructions, loaded only when the skill is invoked.
```

- The first line must be exactly `---`. A UTF-8 BOM before it breaks the check in `dsh-skill-filesystem`, and the file is then ignored as "missing YAML frontmatter" — this plugin's own frontmatter editor tolerates a BOM, the discovery parser does not.
- The frontmatter ends at the next line that is exactly `---`. The body is everything after it, **trimmed** at both ends.
- The frontmatter is parsed as YAML and must be a mapping. An array or a bare scalar is not frontmatter.
- A directory bundle holds this file as `<root>/<name>/SKILL.md`; the flat form `<root>/<name>.md` is equivalent, but its resource base directory is the whole root, so use the bundle form for anything with resources.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | routing name; must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` — lowercase kebab-case, no underscores, no double or trailing hyphens |
| `description` | yes | the routing sentence the model sees in the catalog; write "Use when …" and name the tasks |
| `whenToUse` | no | provider metadata; **not** rendered into the session catalog, so it never helps routing — put routing text in `description` |
| `metadata` | no | free-form object, preserved for consumers |
| `disable-model-invocation` | no | `true` keeps the skill out of the model catalog and the `skill` tool; only an explicit `/name` from the user loads it |
| `user-invocable` | no | `false` disables `/name` for humans while the model keeps access |

Invocation keys accept a boolean or `1`/`0`/`true`/`false`/`yes`/`no`/`on`/`off` (case-insensitive). Any other value throws, and the skill is skipped.

### The spelling trap

The camelCase forms are **rejected on purpose**:

- `disableModelInvocation` → use `disable-model-invocation`
- `modelInvocable` → use `disable-model-invocation`
- `userInvocable` → use `user-invocable`

A file carrying one is skipped with `frontmatter field "…" is unsupported; use "…"`. There is no defaulting, and no partial load.

## The four invocation states

| Frontmatter | Model can load | `/name` works |
|---|---|---|
| (neither key) | yes | yes |
| `disable-model-invocation: true` | no | yes |
| `user-invocable: false` | yes | no |
| both | no | no — the skill is registered but unreachable; almost always a mistake |

`disable-model-invocation: true` is the right choice for a workflow a human must start deliberately (a release, a destructive migration): the catalog and the `skill` tool never advertise it, and the only entry point is the user typing `/name`.

## Why a skill does not load

Discovery logs one warning and skips the file; nothing reaches the model catalog, so a broken skill is indistinguishable from an absent one from inside the session. Check the host log for `skill file <path> ignored:` and the reason:

| Warning | Cause |
|---|---|
| `missing YAML frontmatter` | no leading `---`, a BOM before it, or no closing `---` |
| `invalid YAML frontmatter` | the block does not parse (tabs, unbalanced quotes, bad nesting) |
| `frontmatter requires name and description` | either key missing, or not a non-empty string |
| `invalid skill name "…"` | uppercase, underscore, space, or a doubled/trailing hyphen |
| `invalid invocation frontmatter` | a non-boolean value, or a camelCase legacy key |

## Rules that keep the skill manageable

- **Keep `name` equal to the directory name.** Discovery takes the name from frontmatter, but the Skill Center panel and `skill_create` locate a skill on disk as `<root>/<name>/SKILL.md`. A mismatch (or two directories claiming one name) makes a skill that loads but cannot be opened, edited or deleted.
- **One skill per bundle.** A second `SKILL.md` at a scanned root's direct child level becomes a second skill; only put extra `SKILL.md` files deeper, where discovery does not look.
- **Do not write these files by hand-editing YAML with a formatter.** The panel rewrites only the invocation keys and preserves the rest byte for byte, but an external formatter that reflows the block can turn `description` into a folded scalar and change what the model sees.
