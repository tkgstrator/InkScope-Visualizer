#!/usr/bin/env bash
set -euo pipefail

test_project="inkscope-visualizer-test-$$"
test_url="postgres://inkscope:inkscope_local_only@127.0.0.1:10253/inkscope"

cleanup() {
  docker compose -p "$test_project" -f compose.yaml down -v --remove-orphans
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose -p "$test_project" -f compose.yaml up -d --wait postgres
INKSCOPE_TEST_DATABASE_URL="$test_url" bun test api/postgres.test.ts
