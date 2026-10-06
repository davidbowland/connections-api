# Lambdas for Connections API

Lambdas for Connections API, which serves the daily word-connections game as a back-end for connections-ui.

## Setup

The `developer` role is required to deploy this project.

### Node / NPM

1. [Node](https://nodejs.org/en/)
1. [NPM](https://www.npmjs.com/)

### AWS Credentials

To run locally, [AWS CLI](https://aws.amazon.com/cli/) is required in order to assume a role with permission to update resources. Install AWS CLI with:

```brew
brew install awscli
```

If file `~/.aws/credentials` does not exist, create it and add a default profile:

```toml
[default]
aws_access_key_id=<YOUR_ACCESS_KEY_ID>
aws_secret_access_key=<YOUR_SECRET_ACCESS_KEY>
region=us-east-2
```

If necessary, generate a [new access key ID and secret access key](https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html#access-keys-and-secret-access-keys).

Add a `developer` profile to the same credentials file:

```toml
[developer]
role_arn=arn:aws:iam::<account number>:role/developer
source_profile=default
mfa_serial=<YOUR_MFA_ARN>
region=us-east-2
```

If necessary, retrieve the ARN of the primary MFA device attached to the default profile:

```bash
aws iam list-mfa-devices --query 'MFADevices[].SerialNumber' --output text
```

## Developing Locally

### Unit Tests

[Jest](https://jestjs.io/) tests are run automatically on commit and push. If the test coverage threshold is not met, the push will fail. See `jest.config.ts` for coverage threshold.

Manually run tests with:

```bash
npm run test
```

### Prettier / Linter

Both [Prettier](https://prettier.io/) and [ESLint](https://eslint.org/) are executed on commit. Manually prettify and lint code with:

```bash
npm run lint
```

### Generating Games Locally

Games can be generated without Bedrock. `scripts/local-game.ts` runs the create-game pipeline's code steps (constraint rolls, validation, upload) with the Lambda's own code, and `scripts/generate-games.sh` drives it, piping the generate and verify prompts through headless Claude Code (`claude -p`) in between. Dates run in order, each with up to 3 attempts. Uploads never overwrite an existing game, and the scheduled and on-demand Lambdas skip any date that already has one. Each `claude -p` call runs isolated from your personal Claude Code settings (no CLAUDE.md, hooks, skills, or MCP servers) and without your AWS credentials or `CLAUDE_CODE_USE_BEDROCK`, so it always bills your Claude login, never Bedrock.

It needs a gitignored `.env.local` mirroring CreateGameFunction's environment in `template.yaml`, developer-role credentials in the shell, `jq`, and a logged-in `claude`. Prompts are read from `prompts/`, and each upload's `Usage` is `{"source":"local"}`.

```bash
npm run generate-games -- 2026-10-05..2026-10-12
CLAUDE_MODEL=sonnet CLAUDE_EFFORT=medium npm run generate-games -- 2026-10-05   # defaults: opus, high
```

Work files for each date are left in `.local-games/<date>/`. The individual steps can also be run by hand with `npm run local-game -- <prepare|check|finalize> <date>`.

### Deploying to Production

Deployment runs via GitHub Actions (`.github/workflows/pipeline.yaml`). On a push to `master`, `sam build` bundles each Lambda with esbuild, `sam package` uploads the build artifacts to S3, and `sam deploy` updates the stack — first in the testing account, then in production.

In extreme cases, the stack can be deployed locally with:

```bash
npm run deploy
```

## Infrastructure

The SAM/CloudFormation stack lives in this repo's `template.yaml`. Shared account-level infrastructure (pipeline roles, S3 buckets, etc.) is managed separately in [connections-infrastructure](https://github.com/davidbowland/connections-infrastructure).

## Additional Documentation

- [AWS Lambda](https://aws.amazon.com/lambda/)

- [ESLint](https://eslint.org/)

- [Jest](https://jestjs.io/)

- [Prettier](https://prettier.io/)
