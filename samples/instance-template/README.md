# Instance repo template

Repository-level files for a deployment's **private instance repo**, in addition to the content
files you start from [`samples/instance/`](../instance/). Copy the `.github/` folder into the root
of the instance repo:

- [`.github/workflows/validate-and-deploy.yml`](.github/workflows/validate-and-deploy.yml) validates
  every pull request and push against this repo's `main`, and after a push to `main` starts the
  `deploy` workflow here for test, then production (after the owner's approval).

It needs one secret in the instance repo, `DEPLOY_DISPATCH_TOKEN`. Setup, the token's permissions
and day-to-day use: [docs/runbooks/instance-repo.md](../../docs/runbooks/instance-repo.md).

Do not copy this README into the instance repo; it describes the template only.
