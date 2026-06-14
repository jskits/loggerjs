# Release

LoggerJS uses Changesets for versioning and a GitHub Actions release workflow for npm publishing.

## Local Validation

Run the full release dry-run before cutting a release:

```bash
pnpm release:dry-run
```

This runs the normal quality gate, verifies public exports and API reports, checks every package with `npm pack --dry-run --json`, installs publish-style tarballs into a temporary consumer smoke project, prints Changesets status, and runs `pnpm publish -r --dry-run --access public --no-git-checks --json`.

For canary validation without publishing:

```bash
pnpm release:canary:dry-run
```

Use the real `canary` dist-tag only from a versioned prerelease branch or workflow:

```bash
pnpm check
changeset publish --tag canary
```

## NPM Publishing

The release workflow is `.github/workflows/release.yml`. Each publishable `@loggerjs/*` package should be configured on npmjs.com with a Trusted Publisher entry for:

- Organization or user: `jskits`
- Repository: `loggerjs`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

The workflow uses npm Trusted Publisher/OIDC for npm publishing; it does not read `NPM_AUTH_TOKEN`, `NPM_TOKEN`, or `NODE_AUTH_TOKEN`.

- `permissions.id-token: write` lets GitHub Actions mint the OIDC token npm exchanges during `npm publish`.
- `actions/setup-node` sets the npm registry for the publish command without configuring a long-lived token.
- The release job runs on a GitHub-hosted Ubuntu runner with Node 24 and upgrades to npm 11 so Trusted Publisher support is current.
- Every publishable package sets `publishConfig.provenance=true`, the publish step sets `NPM_CONFIG_PROVENANCE=true`, and the publish script passes `--provenance` explicitly to `pnpm publish`.
- `npm whoami` is not a useful preflight for Trusted Publisher because OIDC authentication only exists during the publish operation.

npm requires package provenance to come from a public source repository, and the package `repository` metadata must match that source repo.

Commits do not trigger publishing. To publish, first consume pending changesets with `pnpm version-packages`, commit the versioned package metadata, and push that commit through normal CI. After the version commit is on `main`, create and push a release tag such as `v0.0.3`; `.github/workflows/release.yml` only listens to `v*` tag pushes and rejects tags whose commits are not reachable from `origin/main`. The release job blocks if pending changesets still exist, runs `pnpm release:publish`, publishes each not-yet-published workspace package with `pnpm publish --provenance`, then creates package release tags with the idempotent `changeset tag` command before pushing `@loggerjs/*` package tags.

If npm returns an authentication error during publish, verify that every package's Trusted Publisher settings exactly match the repository owner, repository name, workflow filename, and optional environment name. npm checks these fields only when a publish is attempted.

References:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/
