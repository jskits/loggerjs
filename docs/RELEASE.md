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

## Trusted Publishing

The release workflow is `.github/workflows/release.yml`. Configure every `@loggerjs/*` npm package to trust that workflow before the first publish.

The workflow intentionally uses OIDC trusted publishing rather than a long-lived npm token:

- `permissions.id-token: write` lets GitHub Actions mint the OIDC token npm requires.
- `actions/setup-node` sets the npm registry.
- The workflow upgrades to npm 11 because npm trusted publishing requires npm CLI 11.5.1 or newer.
- `NPM_CONFIG_PROVENANCE=true` requests npm provenance when `changeset publish` publishes packages.

npm requires package provenance to come from a public source repository, and the package `repository` metadata must match that source repo.

Pushes to `main` run validation and, when pending changesets exist, commit the versioned package metadata back to `main`. Real npm publishing is intentionally manual: run the `Release` workflow with `publish=true` after the npm trusted publisher setup is ready. Push-triggered runs still execute the publish dry run when there are no pending changesets, but they do not publish to npm.

References:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/
