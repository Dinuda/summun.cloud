# Summun Rebrand Plan (Industry-Standard Fork Workflow)

This repo started as a fork of Paperclip. Use this staged process to rebrand safely while staying mergeable with upstream.

## 1. Keep Upstream + Your Origin

Keep two remotes:

- `origin` = your repo (`Dinuda/summun.cloud`)
- `upstream` = original Paperclip repo

```sh
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream
```

Why: this lets you pull security fixes and core improvements from upstream without re-forking.

## 2. Rebrand in Phases (Do Not Big-Bang Replace)

### Phase A: Public-facing brand (safe)

- UI title/manifest/app copy -> `Summun`
- docs links -> `summun.cloud`
- local dev defaults (`.env.example`, docker compose db user/db names)
- CLI alias (`pnpm summun ...`) while retaining legacy command paths

### Phase B: Compatibility layer (recommended)

- keep legacy env prefixes and protocol keys (`PAPERCLIP_*`) for now
- keep existing package scope (`@paperclipai/*`) until you are ready for a major version migration
- support both old and new operator commands during transition

### Phase C: Hard rename (breaking)

- rename package scope from `@paperclipai/*` to `@summun/*`
- rename CLI npm package/binary if desired
- migrate config/data dir names (`~/.paperclip` -> `~/.summun`) with explicit migration tooling

Do this only after tests are green and compatibility shims exist.

## 3. Rename Policy

Use this rule to avoid breaking behavior:

- **Rename now**: branding text, docs, domains, UI labels
- **Delay rename**: API headers, env var prefixes, DB field names, protocol payload keys, npm scopes

## 4. Verification Gate (every phase)

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

If a phase breaks these checks, rollback that phase and split into smaller commits.

## 5. Merge Hygiene

For long-lived maintainability:

1. Keep rebrand commits separate from feature commits.
2. Prefer additive compatibility over destructive replacement.
3. Rebase/merge upstream frequently (weekly is typical).

## 6. Ethical Attribution Checklist

For MIT-licensed upstream projects, standard practice is:

1. Keep the original `LICENSE` text intact.
2. Add a `NOTICE` (or equivalent) that states:
   - this repo is a fork
   - upstream project/repo URL
   - upstream copyright holder(s)
3. Add a visible attribution section in `README`.
4. Preserve attribution in distributed artifacts and docs.
5. Keep an `upstream` git remote and merge/fetch history transparently.
