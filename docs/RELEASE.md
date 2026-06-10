# Release

LoggerJS uses Changesets for versioning and a GitHub Actions release workflow for npm publishing.

## Local Validation

Run the full release dry-run before cutting a release:

```bash
pnpm release:dry-run
```

This runs the normal quality gate, verifies public exports and API reports, checks every package with `npm pack --dry-run --json`, prints Changesets status, and runs `pnpm publish -r --dry-run --access public --no-git-checks --json`.

## Trusted Publishing

The release workflow is `.github/workflows/release.yml`. Configure every `@loggerjs/*` npm package to trust that workflow before the first publish.

The workflow intentionally uses OIDC trusted publishing rather than a long-lived npm token:

- `permissions.id-token: write` lets GitHub Actions mint the OIDC token npm requires.
- `actions/setup-node` sets the npm registry.
- `NPM_CONFIG_PROVENANCE=true` requests npm provenance when `changeset publish` publishes packages.

npm requires package provenance to come from a public source repository, and the package `repository` metadata must match that source repo.

References:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/
