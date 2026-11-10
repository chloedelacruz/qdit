#!/usr/bin/env bash
# Runs the jobs from .github/workflows/ci.yml on this machine.
#
# GitHub Actions only runs on `main`. Any other branch is checked here before
# it is pushed (.githooks/pre-push calls this script), so a branch never
# reaches the remote without the checks CI would have run.
#
#   scripts/ci-local.sh                 jobs for paths changed since origin/main
#   scripts/ci-local.sh --all           every job
#   scripts/ci-local.sh web database    only the jobs named
#
# Jobs and the paths that select them:
#   web       web/                lint, typecheck, Vitest, next build
#   contracts contracts/          cargo fmt --check, clippy -D warnings, test
#   wasm      contracts/          stellar contract build
#   database  supabase/           supabase db start, supabase test db
#   packages  packages/           npm build, typecheck, test
# docs/merkle/ (the shared Merkle vectors) selects contracts and packages.
# A change to .github/workflows/ or scripts/ci-local.sh selects every job.
#
# Keep this in step with ci.yml: when a job there changes, change it here.

set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

all_jobs=(web contracts wasm database packages)
jobs=()

if [[ $# -gt 0 && "$1" == "--all" ]]; then
  jobs=("${all_jobs[@]}")
elif [[ $# -gt 0 ]]; then
  jobs=("$@")
else
  base="${CI_LOCAL_BASE:-origin/main}"
  if ! git rev-parse --verify --quiet "$base" >/dev/null; then
    echo "ci-local: $base not found; running every job" >&2
    jobs=("${all_jobs[@]}")
  else
    changed="$(git diff --name-only "$(git merge-base "$base" HEAD)" HEAD)"
    if grep -qE '^(\.github/workflows/|scripts/ci-local\.sh$|\.githooks/)' <<<"$changed"; then
      jobs=("${all_jobs[@]}")
    else
      grep -q '^web/' <<<"$changed" && jobs+=(web)
      grep -q '^contracts/' <<<"$changed" && jobs+=(contracts wasm)
      grep -q '^supabase/' <<<"$changed" && jobs+=(database)
      grep -q '^packages/' <<<"$changed" && jobs+=(packages)
      if grep -q '^docs/merkle/' <<<"$changed"; then
        [[ " ${jobs[*]} " == *" contracts "* ]] || jobs+=(contracts)
        [[ " ${jobs[*]} " == *" packages "* ]] || jobs+=(packages)
      fi
    fi
  fi
fi

if [[ ${#jobs[@]} -eq 0 ]]; then
  echo "ci-local: nothing CI checks has changed"
  exit 0
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ci-local: '$1' is needed for the $2 job and is not installed" >&2
    exit 1
  }
}

job_web() {
  need npm web
  cd "$root/web"
  [[ -d node_modules ]] || npm ci
  npm run lint
  npm run typecheck
  npm test
  # The same build-time placeholders CI uses, so the build never depends on
  # a real environment or a deployed contract.
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_placeholder \
  NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 \
  NEXT_PUBLIC_STELLAR_NETWORK=testnet \
  NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID="" \
    npm run build
}

job_contracts() {
  need cargo contracts
  cd "$root/contracts"
  cargo fmt --all --check
  cargo clippy --all-targets -- -D warnings
  cargo test
}

job_wasm() {
  need stellar wasm
  cd "$root/contracts"
  stellar contract build
  test -s target/wasm32v1-none/release/milestone_proof.wasm
}

# The same Supabase CLI CI pins (the `version:` under supabase/setup-cli in
# ci.yml), run through npx, so a newer CLI installed on this machine cannot
# disagree with CI about config.toml or the images.
supabase_cli() {
  local v
  v="$(awk '/supabase\/setup-cli/{f=1} f&&/version:/{print $2; exit}' "$root/.github/workflows/ci.yml")"
  [[ -n "$v" ]] || { echo "ci-local: no Supabase CLI version pinned in ci.yml" >&2; return 1; }
  npx --yes "supabase@$v" "$@"
}

job_packages() {
  need npm packages
  cd "$root/packages"
  [[ -d node_modules ]] || npm ci
  npm run build   # first: qdit-batch imports @qdit/merkle through its dist/
  npm run typecheck
  npm test
}

job_database() {
  need npx database
  need docker database
  docker info >/dev/null 2>&1 || {
    echo "ci-local: Docker is not running; the database job needs it" >&2
    exit 1
  }
  cd "$root"
  # A database left running from earlier would keep old migrations, so it is
  # rebuilt from supabase/migrations/ and the seed, as CI builds it fresh.
  if supabase_cli status >/dev/null 2>&1; then
    supabase_cli db reset
  else
    supabase_cli db start
  fi
  supabase_cli test db
}

failed=()
for job in "${jobs[@]}"; do
  case "$job" in web|contracts|wasm|database|packages) ;; *)
    echo "ci-local: unknown job '$job' (jobs: ${all_jobs[*]})" >&2
    exit 2 ;;
  esac
  echo "── ci-local: $job"
  if ( "job_$job" ); then
    echo "── ci-local: $job passed"
  else
    echo "── ci-local: $job FAILED" >&2
    failed+=("$job")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "ci-local: failed: ${failed[*]}" >&2
  exit 1
fi
echo "ci-local: all passed (${jobs[*]})"
