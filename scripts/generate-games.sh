#!/usr/bin/env bash

# Generate games locally and upload them, with headless Claude Code (`claude -p`) doing the two model
# steps instead of Bedrock. Node (scripts/local-game.ts) does everything else with the Lambda's own
# code, so every check the Lambda runs runs here too.
#
#   ./scripts/generate-games.sh 2026-10-05                 one date
#   ./scripts/generate-games.sh 2026-10-05 2026-10-09      several dates
#   ./scripts/generate-games.sh 2026-10-05..2026-10-12     inclusive range
#
# Needs developer-role credentials in the shell, .env.local, jq, and a logged-in `claude`.
# CLAUDE_MODEL and CLAUDE_EFFORT override the model settings (defaults match the Lambda's prompts).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_ROOT="$ROOT/.local-games"
MAX_ATTEMPTS=3
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
CLAUDE_EFFORT="${CLAUDE_EFFORT:-high}"

# Expand ranges with Node: BSD and GNU `date` disagree on date arithmetic.
expand_dates() {
  node -e '
  for (const arg of process.argv.slice(1)) {
    const [start, end = start] = arg.split("..")
    const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s)) && new Date(s).toISOString().startsWith(s)
    if (!valid(start) || !valid(end) || start > end) {
      console.error(`Invalid date or range: ${arg}`)
      process.exit(1)
    }
    for (let d = new Date(start); d <= new Date(end); d.setUTCDate(d.getUTCDate() + 1)) {
      console.log(d.toISOString().slice(0, 10))
    }
  }
' "$@" | sort -u
}

local_game() {
  (cd "$ROOT" && npm run --silent local-game -- "$@")
}

# One model step. The rendered prompt goes in as the user turn, as it does on Bedrock, and the tool's
# input_schema becomes the structured-output schema, so the reply is the tool input. The tool's
# description travels in the system prompt and the schema, as it does on Bedrock, because it carries
# instructions the schema cannot (how many decoys, across how many categories).
#
# Isolated three ways. An empty temporary directory with all tools off keeps project context out. The
# --setting-sources, --strict-mcp-config and --disable-slash-commands flags keep the developer's own
# CLAUDE.md, hooks, skills and MCP servers out; without them every call carries those into what should
# be a bare model call (--bare would also drop them, but requires an API key). And `env -u` drops the
# AWS credentials and provider switches, which would otherwise let claude bill Bedrock on the
# developer role -- the cost this script exists to avoid.
run_model() {
  local prompt_file="$1" tool_file="$2" output_file="$3"
  local scratch result system_prompt
  system_prompt="Follow the instructions in the user message. Your reply is the input to the tool it names.

The tool is $(jq -r .name "$tool_file"): $(jq -r .description "$tool_file")"
  scratch=$(mktemp -d)
  result=$(
    cd "$scratch" &&
      env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
        -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX \
        claude -p \
        --model "$CLAUDE_MODEL" \
        --effort "$CLAUDE_EFFORT" \
        --tools "" \
        --no-session-persistence \
        --setting-sources "" \
        --strict-mcp-config \
        --disable-slash-commands \
        --system-prompt "$system_prompt" \
        --output-format json \
        --json-schema "$(jq -c '.input_schema + {description: .description}' "$tool_file")" \
        <"$prompt_file"
  )
  local exit_code=$?
  rm -rf "$scratch"
  if [[ $exit_code -ne 0 ]] || ! jq -e '.structured_output' <<<"$result" >"$output_file" 2>/dev/null; then
    echo "claude -p returned no structured output: $(jq -r '.result // .' <<<"$result" 2>/dev/null | head -c 300)" >&2
    return 1
  fi
}

# Prints the reason when the CLI fails, so the summary can say why an attempt was abandoned.
step() {
  local output
  output=$(local_game "$@" 2>&1)
  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    grep '^FAILED:' <<<"$output" | tail -1 | sed 's/^FAILED: //'
    return 1
  fi
  grep -E '^(PREPARED|CHECKED|UPLOADED|  )' <<<"$output"
}

generate_date() {
  local date="$1" dir="$WORK_ROOT/$1" attempt reason
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    echo "[$date] attempt $attempt/$MAX_ATTEMPTS"

    if ! reason=$(step prepare "$date"); then
      if [[ "$reason" == Game\ already\ exists* ]]; then
        SUMMARY+=("$date  skipped (game already exists)")
        return
      fi
      echo "[$date] prepare failed: $reason"
      SUMMARY+=("$date  FAILED: $reason")
      return
    fi

    echo "[$date] generating with claude -p ($CLAUDE_MODEL, effort $CLAUDE_EFFORT)..."
    if ! run_model "$dir/generate-prompt.txt" "$dir/generate-tool.json" "$dir/generated.json"; then
      continue
    fi
    if ! reason=$(step check "$date"); then
      echo "[$date] check failed: $reason"
      continue
    fi

    echo "[$date] verifying with claude -p..."
    if ! run_model "$dir/verify-prompt.txt" "$dir/verify-tool.json" "$dir/verdict.json"; then
      continue
    fi
    if ! reason=$(step finalize "$date"); then
      echo "[$date] finalize failed: $reason"
      if [[ "$reason" == Game\ already\ exists* ]]; then
        SUMMARY+=("$date  skipped (game appeared during generation)")
        return
      fi
      continue
    fi

    echo "$reason"
    SUMMARY+=("$date  uploaded on attempt $attempt")
    return
  done
  SUMMARY+=("$date  FAILED after $MAX_ATTEMPTS attempts (work files in .local-games/$date)")
}

main() {
  if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD> ..." >&2
    exit 1
  fi
  local dates
  dates=$(expand_dates "$@") || exit 1

  SUMMARY=()
  # Strictly in order, one at a time: each prepare reads every stored game to build the disallowed
  # categories, so a date must be uploaded before the next one is prepared.
  for date in $dates; do
    generate_date "$date"
  done

  echo
  echo "Summary:"
  printf '  %s\n' "${SUMMARY[@]}"
}

# Sourcing the file (to test one function) defines everything without running.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
