# Contributing to SK Image

Thanks for helping improve SK Image!

## Set up

```bash
git clone https://github.com/dillan/sk-image.git
cd sk-image
npm install    # also installs the git hooks (via simple-git-hooks)
```

Requires Node.js 24 or newer (see `.nvmrc`).

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run format:check
npm run lint
npm run build
npm run test:coverage
```

Tests are [Vitest](https://vitest.dev/) specs co-located with the source as `src/**/*.spec.ts`. Please add or update a spec for any behavior change — write the failing test first when you can.

## Commit messages: Conventional Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/); a git hook runs `commitlint` on every commit. The type decides the release:

| Type | Example | Triggers a release? |
| --- | --- | --- |
| `feat` | `feat: add collection filtering` | Yes — minor |
| `fix` | `fix: reject zero-byte uploads` | Yes — patch |
| `perf` | `perf: cache cache-stats between purges` | Yes — patch |
| `docs`, `test`, `refactor`, `chore`, `ci`, `style`, `build` | `docs: clarify cache purge` | No |

A breaking change (`feat!:` or a `BREAKING CHANGE:` footer) triggers a major release.

Please do not add AI attribution to commits or PRs (no `Co-Authored-By`, no "Generated with").

## Pull requests

Open PRs against `main`. Fill in the PR template, keep changes focused, and make sure the four checks above pass.

## Releases

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) on pushes to `main`, publishing to npm via GitHub Actions OIDC trusted publishing (no npm token stored).

Releasing is **disabled until it's configured once**:

1. Publish the package to npm by hand the first time.
2. On npmjs.com, add a GitHub Actions **trusted publisher** for this package: user `dillan`, repository `sk-image`, workflow `release.yml`.
3. Set the repository variable `RELEASE_ENABLED=true`.

After that, every `feat`/`fix`/`perf` merged to `main` cuts and publishes a release automatically.
