#!/usr/bin/env bash

# Stop immediately on error
set -e

if [[ -z "$1" ]]; then
  $(./scripts/assumeDeveloperRole.sh)
fi

# Only install production modules
export NODE_ENV=production

# Build the project
SAM_TEMPLATE=template.yaml
sam build --template ${SAM_TEMPLATE}

# Start the API locally
export DYNAMODB_GAMES_TABLE_NAME=connections-api-games-test

sam local start-api --region=us-east-1 --force-image-build --parameter-overrides "Environment=test" --log-file local.log
