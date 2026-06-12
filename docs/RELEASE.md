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

The release workflow is `.github/workflows/release.yml`. Configure the GitHub secret `NPM_AUTH_TOKEN` with an npm automation token that can publish every `@loggerjs/*` package. `NPM_TOKEN` is accepted as a fallback name.

The workflow uses token authentication for npm publishing and OIDC for provenance:

- `actions/setup-node` sets the npm registry and configures npm to read auth from `NODE_AUTH_TOKEN`.
- Publish steps map `secrets.NPM_AUTH_TOKEN` or `secrets.NPM_TOKEN` to `NODE_AUTH_TOKEN`, which is what npm expects.
- `permissions.id-token: write` lets GitHub Actions mint the OIDC token npm uses for provenance.
- The workflow upgrades to npm 11 so provenance support is current.
- Every publishable package sets `publishConfig.provenance=true`, and the publish step also sets `NPM_CONFIG_PROVENANCE=true`.

npm requires package provenance to come from a public source repository, and the package `repository` metadata must match that source repo.

Pushes to `main` run validation and publish. When pending changesets exist, the workflow first commits the versioned package metadata back to `main`, then publishes from that same checked-out versioned tree. Publishing runs `changeset publish --no-git-tag`, then creates release tags with the idempotent `changeset tag` command before pushing tags. Manual runs without `publish=true` only validate and dry-run; manual runs with `publish=true` publish only when there are no pending changesets.

For an organization-level npm secret, make sure the secret's repository access includes `jskits/loggerjs`. Public repositories are not covered when the secret is limited to private repositories only.

References:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/
