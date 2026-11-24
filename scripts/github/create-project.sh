#!/usr/bin/env bash
# create-project.sh: create or update the WeddingPlanner project board, labels and milestones.
#
# Run by the repository owner with an authenticated `gh` (needs the `project` scope:
# `gh auth refresh -s project`). Never run by CI. Idempotent: reads the current state first
# and changes only what is missing or different; existing project items, field values and
# option ids are preserved, and nothing is deleted.
#
# Usage: scripts/github/create-project.sh [--repo OWNER/NAME] [--title TITLE] [--dry-run]
#
#   --repo OWNER/NAME  repository (default: the current directory's GitHub repo)
#   --title TITLE      project title (default: the repository name)
#   --dry-run          only report what would change; make no changes
#
# What it ensures:
#   - a project (owned by the repository owner and linked to the repository) with the fields
#       Status  Todo / In Progress / In Review / Done (single select)
#       Stage   Stage 0 .. Stage 3 (single select)
#       Area    web, api, infra, ci, content, docs, e2e, ops (single select)
#       Size    S, M, L (single select)
#       Expert  free text: the specialist profile that implements the task
#   - labels area:*, type:*, priority:critical-path, needs:owner, blocked, incident
#   - milestones Stage 0 to Stage 3
#
# Requires: gh, jq. Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

# name|color|description
LABELS='area:web|1d76db|Frontend (React/Vite)
area:api|5319e7|.NET Functions API / Domain
area:infra|0e8a16|Bicep / Azure infrastructure
area:ci|fbca04|GitHub Actions / CI/CD
area:content|c5def5|Content schema, bake, instance repo
area:docs|d4c5f9|README, CLAUDE.md, conventions, ADRs
area:e2e|f9d0c4|Playwright / end-to-end tests
area:ops|bfd4f2|Operations scripts and runbooks
type:feature|a2eeef|New functionality
type:chore|ededed|Tooling, setup, maintenance
type:bug|d73a4a|Something does not work as documented
priority:critical-path|b60205|On the critical path to RSVP go-live
needs:owner|d93f0b|Blocked on a manual step by the owner
blocked|e99695|Waiting for another issue or an external dependency
incident|b60205|Deployed environment unhealthy (opened and closed by the uptime check)'

# title|description
MILESTONES='Stage 0 – Foundation & CI/CD|Repo skeleton, tooling, infra, pipelines, walking skeleton live
Stage 1 – Public site|All public sections, content pipeline, environments, go-live with real content
Stage 2 – RSVP|RSVP API + UI, cookies/edit link, abuse protection, write-path e2e; RSVP opens
Stage 3 – Admin|Admin area: responses, guest list, fuzzy matching, settings, CSV export'

# Single-select fields, one option per line: name|COLOR|description
STATUS_OPTIONS='Todo|GRAY|Ready to start (dependencies may still be open)
In Progress|YELLOW|An implementer is working on it
In Review|PURPLE|PR open: CI + independent review
Done|GREEN|Merged to main'
STAGE_OPTIONS='Stage 0|GRAY|Foundation & CI/CD
Stage 1|BLUE|Public site
Stage 2|GREEN|RSVP
Stage 3|PURPLE|Admin'
AREA_OPTIONS='web|BLUE|Frontend (React/Vite)
api|PURPLE|.NET Functions API / Domain
infra|GREEN|Bicep / Azure infrastructure
ci|YELLOW|GitHub Actions / CI/CD
content|ORANGE|Content schema, bake, instance repo
docs|GRAY|README, CLAUDE.md, conventions, ADRs
e2e|PINK|Playwright / end-to-end tests
ops|RED|Operations scripts and runbooks'
SIZE_OPTIONS='S|GREEN|Small: a few files, well understood
M|YELLOW|Medium: one focused PR
L|ORANGE|Large: consider splitting'

REPO=""
TITLE=""
DRY_RUN=false
CHANGES=0
TMP_DIR=""
PROJECT_ID=""

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

section() { printf '\n%s\n' "$*"; }
ok() { printf '  ok       %s\n' "$*"; }
changed() {
  CHANGES=$((CHANGES + 1))
  if [ "$DRY_RUN" = true ]; then
    printf '  would    %s\n' "$*"
  else
    printf '  change   %s\n' "$*"
  fi
}

cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
}

# api_get_list PATH: print the JSON array of all pages, merged. Dies on error.
api_get_list() {
  gh api --paginate "$1" 2>"$TMP_DIR/stderr" | jq -s 'add // []' ||
    {
      cat "$TMP_DIR/stderr" >&2
      die "GET $1 failed"
    }
}

# api_write METHOD PATH JSON: send a change (skipped in dry-run mode). Dies on error.
api_write() {
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  printf '%s' "$3" | gh api -X "$1" "$2" --input - >/dev/null
}

# graphql QUERY VARIABLES_JSON: run a GraphQL query and print the response. Dies on error.
graphql() {
  jq -n --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}' |
    gh api graphql --input - 2>"$TMP_DIR/stderr" ||
    {
      cat "$TMP_DIR/stderr" >&2
      die "GraphQL request failed"
    }
}

# graphql_write QUERY VARIABLES_JSON: run a GraphQL mutation (skipped in dry-run mode).
graphql_write() {
  if [ "$DRY_RUN" = true ]; then
    printf '{}'
    return 0
  fi
  graphql "$1" "$2"
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        [ $# -ge 2 ] || die "--repo needs a value"
        REPO=$2
        shift 2
        ;;
      --title)
        [ $# -ge 2 ] || die "--title needs a value"
        TITLE=$2
        shift 2
        ;;
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "unknown argument: $1 (see --help)" ;;
    esac
  done
}

preflight() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CI:-}" = "true" ]; then
    die "this script is run by the repository owner, never by CI"
  fi
  command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) not found"
  command -v jq >/dev/null 2>&1 || die "jq not found"
  if [ -z "$REPO" ]; then
    REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner) ||
      die "cannot determine the repository; pass --repo OWNER/NAME"
  fi
  printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ||
    die "invalid repository name: $REPO (expected OWNER/NAME)"
  if [ -z "$TITLE" ]; then
    TITLE=${REPO#*/}
  fi
}

ensure_labels() {
  local existing name color description current
  section "Labels"
  existing=$(api_get_list "repos/$REPO/labels?per_page=100")
  while IFS='|' read -r name color description <&3; do
    current=$(printf '%s' "$existing" | jq -c --arg n "$name" \
      '[.[] | select((.name | ascii_downcase) == ($n | ascii_downcase))] | first // empty')
    if [ -z "$current" ]; then
      changed "create label $name"
      api_write POST "repos/$REPO/labels" \
        "$(jq -n --arg n "$name" --arg c "$color" --arg d "$description" \
          '{name: $n, color: $c, description: $d}')"
    elif [ "$(printf '%s' "$current" | jq -r --arg n "$name" --arg c "$color" --arg d "$description" \
      '(.name == $n and (.color | ascii_downcase) == $c and (.description // "") == $d)')" != "true" ]; then
      changed "update label $name (name, color or description differ)"
      api_write PATCH "repos/$REPO/labels/$(jq -rn --arg n "$(printf '%s' "$current" | jq -r .name)" '$n | @uri')" \
        "$(jq -n --arg n "$name" --arg c "$color" --arg d "$description" \
          '{new_name: $n, color: $c, description: $d}')"
    else
      ok "label $name"
    fi
  done 3<<<"$LABELS"
}

ensure_milestones() {
  local existing title description current number
  section "Milestones"
  existing=$(api_get_list "repos/$REPO/milestones?state=all&per_page=100")
  while IFS='|' read -r title description <&3; do
    current=$(printf '%s' "$existing" | jq -c --arg t "$title" '[.[] | select(.title == $t)] | first // empty')
    if [ -z "$current" ]; then
      changed "create milestone \"$title\""
      api_write POST "repos/$REPO/milestones" \
        "$(jq -n --arg t "$title" --arg d "$description" '{title: $t, description: $d}')"
    elif [ "$(printf '%s' "$current" | jq -r '.description // ""')" != "$description" ]; then
      number=$(printf '%s' "$current" | jq -r .number)
      changed "update the description of milestone \"$title\""
      api_write PATCH "repos/$REPO/milestones/$number" \
        "$(jq -n --arg d "$description" '{description: $d}')"
    else
      ok "milestone \"$title\""
    fi
  done 3<<<"$MILESTONES"
}

# shellcheck disable=SC2016 # GraphQL $variables in single-quoted queries are literal
ensure_project() {
  local owner name response repo_id project created
  section "Project \"$TITLE\""
  owner=${REPO%%/*}
  name=${REPO#*/}
  response=$(graphql 'query ProjectsByOwner($login: String!, $name: String!) {
      repository(owner: $login, name: $name) { id }
      repositoryOwner(login: $login) {
        id
        ... on ProjectV2Owner {
          projectsV2(first: 100) {
            nodes { id number title closed repositories(first: 100) { nodes { nameWithOwner } } }
          }
        }
      }
    }' "$(jq -n --arg l "$owner" --arg n "$name" '{login: $l, name: $n}')")
  repo_id=$(printf '%s' "$response" | jq -r '.data.repository.id // empty')
  [ -n "$repo_id" ] || die "repository $REPO not found"
  project=$(printf '%s' "$response" | jq -c --arg t "$TITLE" \
    '[.data.repositoryOwner.projectsV2.nodes[]? | select(.title == $t and (.closed | not))] | first // empty')

  if [ -z "$project" ]; then
    changed "create project \"$TITLE\" owned by $owner, linked to $REPO"
    created=$(graphql_write 'mutation CreateProject($ownerId: ID!, $title: String!, $repositoryId: ID!) {
        createProjectV2(input: {ownerId: $ownerId, title: $title, repositoryId: $repositoryId}) {
          projectV2 { id number }
        }
      }' "$(printf '%s' "$response" | jq -c --arg t "$TITLE" --arg r "$repo_id" \
      '{ownerId: .data.repositoryOwner.id, title: $t, repositoryId: $r}')")
    PROJECT_ID=$(printf '%s' "$created" | jq -r '.data.createProjectV2.projectV2.id // empty')
    if [ "$DRY_RUN" != true ] && [ -z "$PROJECT_ID" ]; then
      die "creating the project returned no id"
    fi
    return
  fi

  PROJECT_ID=$(printf '%s' "$project" | jq -r .id)
  ok "project #$(printf '%s' "$project" | jq -r .number) exists"
  if [ "$(printf '%s' "$project" | jq --arg r "$REPO" \
    '[.repositories.nodes[] | select(.nameWithOwner == $r)] | length')" = "0" ]; then
    changed "link the project to $REPO"
    graphql_write 'mutation LinkProject($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: {projectId: $projectId, repositoryId: $repositoryId}) {
          repository { id }
        }
      }' "$(jq -n --arg p "$PROJECT_ID" --arg r "$repo_id" '{projectId: $p, repositoryId: $r}')" >/dev/null
  else
    ok "project linked to $REPO"
  fi
}

# options_json OPTIONS: convert "name|COLOR|description" lines to a JSON array.
options_json() {
  printf '%s\n' "$1" | jq -R -s -c '
    split("\n") | map(select(length > 0) | split("|") | {name: .[0], color: .[1], description: .[2]})'
}

# ensure_single_select FIELDS_JSON NAME OPTIONS: create the field, or add missing options to it.
# Matching is by name, case-insensitive. Existing options keep their ids (so item values
# survive); the result lists the desired options first, then any extra existing ones.
# shellcheck disable=SC2016 # GraphQL $variables in single-quoted queries are literal
ensure_single_select() {
  local fields=$1 name=$2 wanted field missing merged
  wanted=$(options_json "$3")
  field=$(printf '%s' "$fields" | jq -c --arg n "$name" '[.[] | select(.name == $n)] | first // empty')
  if [ -z "$field" ]; then
    changed "create field $name ($(printf '%s' "$wanted" | jq -r 'map(.name) | join(", ")'))"
    graphql_write 'mutation CreateSingleSelectField($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
        createProjectV2Field(input: {projectId: $projectId, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options}) {
          projectV2Field { ... on ProjectV2SingleSelectField { id } }
        }
      }' "$(jq -n --arg p "$PROJECT_ID" --arg n "$name" --argjson o "$wanted" \
      '{projectId: $p, name: $n, options: $o}')" >/dev/null
    return
  fi
  if [ "$(printf '%s' "$field" | jq -r .dataType)" != "SINGLE_SELECT" ]; then
    printf '  warning  field %s exists but is not a single select; left unchanged\n' "$name" >&2
    return
  fi
  missing=$(jq -n --argjson have "$(printf '%s' "$field" | jq -c '.options // []')" --argjson want "$wanted" \
    '[$want[] | select((.name | ascii_downcase) as $n | [$have[] | .name | ascii_downcase] | index($n) | not) | .name]')
  if [ "$missing" = "[]" ]; then
    ok "field $name"
    return
  fi
  merged=$(jq -n --argjson have "$(printf '%s' "$field" | jq -c '.options // []')" --argjson want "$wanted" '
    ($have | map({key: (.name | ascii_downcase), value: .}) | from_entries) as $byName
    | ($want | map(.name | ascii_downcase)) as $wantNames
    | [$want[] | ($byName[.name | ascii_downcase] // .)]
      + [$have[] | select((.name | ascii_downcase) as $n | $wantNames | index($n) | not)]
    | map({id, name, color, description: (.description // "")} | with_entries(select(.value != null)))')
  changed "add options $(printf '%s' "$missing" | jq -r 'join(", ")') to field $name"
  graphql_write 'mutation UpdateSingleSelectField($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
      updateProjectV2Field(input: {fieldId: $fieldId, singleSelectOptions: $options}) {
        projectV2Field { ... on ProjectV2SingleSelectField { id } }
      }
    }' "$(jq -n --arg f "$(printf '%s' "$field" | jq -r .id)" --argjson o "$merged" \
    '{fieldId: $f, options: $o}')" >/dev/null
}

# shellcheck disable=SC2016 # GraphQL $variables in single-quoted queries are literal
ensure_text_field() {
  local fields=$1 name=$2 field
  field=$(printf '%s' "$fields" | jq -c --arg n "$name" '[.[] | select(.name == $n)] | first // empty')
  if [ -z "$field" ]; then
    changed "create text field $name"
    graphql_write 'mutation CreateTextField($projectId: ID!, $name: String!) {
        createProjectV2Field(input: {projectId: $projectId, dataType: TEXT, name: $name}) {
          projectV2Field { ... on ProjectV2Field { id } }
        }
      }' "$(jq -n --arg p "$PROJECT_ID" --arg n "$name" '{projectId: $p, name: $n}')" >/dev/null
  elif [ "$(printf '%s' "$field" | jq -r .dataType)" != "TEXT" ]; then
    printf '  warning  field %s exists but is not a text field; left unchanged\n' "$name" >&2
  else
    ok "field $name"
  fi
}

# shellcheck disable=SC2016 # GraphQL $variables in single-quoted queries are literal
ensure_fields() {
  local fields
  section "Project fields"
  if [ -z "$PROJECT_ID" ]; then
    # Dry run of a project that does not exist yet: it would get the default Status field.
    fields='[{"id": "new", "name": "Status", "dataType": "SINGLE_SELECT", "options": [
      {"id": "new-todo", "name": "Todo", "color": "GRAY", "description": ""},
      {"id": "new-in-progress", "name": "In Progress", "color": "YELLOW", "description": ""},
      {"id": "new-done", "name": "Done", "color": "GREEN", "description": ""}]}]'
  else
    fields=$(graphql 'query ProjectFields($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 100) {
              nodes {
                ... on ProjectV2FieldCommon { id name dataType }
                ... on ProjectV2SingleSelectField { options { id name color description } }
              }
            }
          }
        }
      }' "$(jq -n --arg p "$PROJECT_ID" '{projectId: $p}')" | jq -c '.data.node.fields.nodes')
  fi
  ensure_single_select "$fields" Status "$STATUS_OPTIONS"
  ensure_single_select "$fields" Stage "$STAGE_OPTIONS"
  ensure_single_select "$fields" Area "$AREA_OPTIONS"
  ensure_single_select "$fields" Size "$SIZE_OPTIONS"
  ensure_text_field "$fields" Expert
}

main() {
  parse_args "$@"
  preflight
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT

  if [ "$DRY_RUN" = true ]; then
    printf 'Setting up labels, milestones and the project for %s (dry run: no changes)\n' "$REPO"
  else
    printf 'Setting up labels, milestones and the project for %s\n' "$REPO"
  fi

  ensure_labels
  ensure_milestones
  ensure_project
  ensure_fields

  section "Summary"
  if [ "$CHANGES" -eq 0 ]; then
    printf '  Nothing to change: labels, milestones and project are as desired.\n'
  elif [ "$DRY_RUN" = true ]; then
    printf '  %d change(s) would be made. Re-run without --dry-run to apply them.\n' "$CHANGES"
  else
    printf '  %d change(s) applied. Re-running this script is safe.\n' "$CHANGES"
  fi
}

main "$@"
