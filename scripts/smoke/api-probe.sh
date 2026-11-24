#!/usr/bin/env bash
# api-probe.sh: platform probe for the Static Web Apps managed API (GET /api/health/probe).
#
# Measures two undocumented behaviours of the Static Web Apps proxy on a deployed environment:
#
#   1. Cookie round trip (checks; any failure exits 1):
#      - a first GET with an empty cookie jar answers 200 and sets exactly one wp_probe cookie with
#        Max-Age=60, Path=/api/health, Secure, HttpOnly, SameSite=Strict, no Expires, no Domain and no
#        other attribute; the API reports that it received no cookie;
#      - the client stored the cookie, and a second GET with the same jar reports cookieReceived.
#   2. Client-IP headers (report only): the forwarding headers that reach the API, the
#      X-Forwarded-For hop count and the XFF position of each single-address header. A third GET then
#      sends spoofed forwarding headers carrying the documentation address 192.0.2.1 (RFC 5737) and
#      reports which headers pass a client-supplied value through, so they can never be trusted for
#      rate limiting.
#
# Output: pass/fail lines, header names, counts and positions only. Never header values, IP
# addresses, hostnames, cookies or BASE_URL. Read-only: GET requests only. The cookie jar lives in a
# temporary directory that is removed on exit.
#
# Usage: BASE_URL=https://<host> scripts/smoke/api-probe.sh
#
# Environment:
#   BASE_URL       origin of the deployment, required and never printed. https only; plain http is
#                  accepted for localhost (the local Functions host).
#   PROBE_TIMEOUT  seconds per request (default 60, enough for a cold start)
#
# Exit codes: 0 every check passed, 1 a check failed, 2 usage error or missing tool.
#
# Requires: curl, jq. Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

readonly COOKIE_NAME="wp_probe"
readonly COOKIE_VALUE="1"
readonly COOKIE_MAX_AGE="60"
readonly COOKIE_PATH="/api/health"
readonly SPOOF_ADDRESS="192.0.2.1"
readonly SPOOF_HEADERS="x-forwarded-for x-original-for x-azure-clientip x-azure-socketip x-client-ip client-ip x-real-ip true-client-ip"

CHECKS=0
FAILURES=0
TMP_DIR=""
PROBE_URL=""
TIMEOUT=""

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

pass() {
  CHECKS=$((CHECKS + 1))
  printf '[pass] %s\n' "$*"
}

fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  printf '[fail] %s\n' "$*"
}

check() {
  local description=$1
  shift
  if "$@"; then
    pass "$description"
  else
    fail "$description"
  fi
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

trim() {
  local value=$1
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

# Sends one GET to the probe. Prints the HTTP status, or 000 when the request failed. curl runs
# silently with stderr discarded: its error messages would name the host.
#   $1 response body file, $2 response headers file, $@ further curl arguments
probe_get() {
  local body=$1 headers=$2
  shift 2
  local status
  if ! status=$(curl --silent --max-time "$TIMEOUT" --proto '=https,http' \
    --header 'Accept: application/json' --header 'Cache-Control: no-cache' \
    --output "$body" --dump-header "$headers" --write-out '%{http_code}' \
    "$@" "$PROBE_URL" 2>/dev/null); then
    status="000"
  fi
  printf '%s' "$status"
}

is_status_200() { [ "$1" = "200" ]; }

is_json_probe() { jq -e 'type == "object" and has("cookieReceived")' "$1" >/dev/null 2>&1; }

json_true() { [ "$(jq -r "$2" "$1" 2>/dev/null)" = "true" ]; }

json_false() { [ "$(jq -r "$2" "$1" 2>/dev/null)" = "false" ]; }

# Prints the values of response header $2 (case-insensitive name), one per line.
header_values() {
  local name
  name=$(lower "$2")
  tr -d '\r' <"$1" | awk -v name="$name" '
    {
      colon = index($0, ":")
      if (colon > 0 && tolower(substr($0, 1, colon - 1)) == name) {
        value = substr($0, colon + 1)
        sub(/^[ \t]+/, "", value)
        print value
      }
    }'
}

# Prints the Set-Cookie header values for $COOKIE_NAME, one per line.
probe_set_cookies() {
  header_values "$1" "set-cookie" | grep "^${COOKIE_NAME}=" || true
}

# Checks the attributes of one Set-Cookie value. Prints attribute names only, never values.
check_cookie_attributes() {
  local header=$1
  local parts part name value index
  local max_age="" path="" secure=false http_only=false same_site="" expires=false domain=false
  local unexpected=""

  IFS=';' read -r -a parts <<<"$header"
  check "cookie value unchanged" [ "$(trim "${parts[0]}")" = "${COOKIE_NAME}=${COOKIE_VALUE}" ]

  index=1
  while [ "$index" -lt "${#parts[@]}" ]; do
    part=$(trim "${parts[$index]}")
    index=$((index + 1))
    [ -n "$part" ] || continue
    name=$(lower "$(trim "${part%%=*}")")
    value=""
    case "$part" in *=*) value=$(trim "${part#*=}") ;; esac
    case "$name" in
      max-age) max_age=$value ;;
      path) path=$value ;;
      secure) secure=true ;;
      httponly) http_only=true ;;
      samesite) same_site=$(lower "$value") ;;
      expires) expires=true ;;
      domain) domain=true ;;
      *)
        if printf '%s' "$name" | grep -Eq '^[a-z][a-z0-9-]{0,31}$'; then
          unexpected="${unexpected} ${name}"
        else
          unexpected="${unexpected} (unprintable)"
        fi
        ;;
    esac
  done

  check "attribute Max-Age=${COOKIE_MAX_AGE}" [ "$max_age" = "$COOKIE_MAX_AGE" ]
  check "attribute Path=${COOKIE_PATH}" [ "$path" = "$COOKIE_PATH" ]
  check "attribute Secure" [ "$secure" = true ]
  check "attribute HttpOnly" [ "$http_only" = true ]
  check "attribute SameSite=Strict" [ "$same_site" = "strict" ]
  check "no Expires attribute" [ "$expires" = false ]
  check "no Domain attribute" [ "$domain" = false ]
  if [ -z "$unexpected" ]; then
    pass "no other attributes"
  else
    fail "unexpected attributes:${unexpected}"
  fi
}

# True when curl's cookie jar holds $COOKIE_NAME (field 6 of the Netscape format).
jar_has_cookie() {
  [ -f "$1" ] && awk -F '\t' -v name="$COOKIE_NAME" '$6 == name { found = 1 } END { exit found ? 0 : 1 }' "$1"
}

# True when the response carries Cache-Control: no-store (the proxy keeps the API's header).
has_no_store() { header_values "$1" "cache-control" | grep -qi 'no-store'; }

# jq helpers shared by the reports: entries of a comma-separated address list, and a joined list.
readonly JQ_DEFS='
  def entries: [split(",")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)];
  def joined: map(tostring) | join(", ");
  def entry_count: if . == 1 then "1 entry" else "\(.) entries" end;
'

# Reports the forwarding headers of a probe response: names, hop counts and the locations (header
# names and list positions) where each single address appears again. Never a value.
report_forwarding_headers() {
  local body=$1
  printf '\nForwarding headers that reach the API (names and positions only):\n'
  jq -r "${JQ_DEFS}"'
    .xffHopCount as $hops
    | .addressMatches as $matches
    | (.forwardingHeaders | to_entries[]
        | if .key == "x-forwarded-for" then "  \(.key): \($hops | entry_count)"
          elif .key == "x-original-for" then "  \(.key): \(.value | entries | length | entry_count)"
          elif $matches[.key] == null then "  \(.key)"
          elif ($matches[.key] | length) == 0 then "  \(.key): address appears nowhere else"
          else "  \(.key): same address as \($matches[.key] | joined)"
          end),
      (if .remoteAddress == null then "  remote address: absent"
       elif ($matches["remote-address"] | length) == 0 then "  remote address: appears nowhere else"
       else "  remote address: same address as \($matches["remote-address"] | joined)"
       end)
  ' "$body"
  printf 'x-ms-client-principal present: %s\n' "$(jq -r '.hasClientPrincipal' "$body")"
  printf 'All request header names: %s\n' "$(jq -r '.requestHeaderNames | join(", ")' "$body")"
}

# Sends spoofed forwarding headers and reports, per header, whether the client value came through.
report_spoofing() {
  local body=$1 headers=$2
  local curl_args=() header status
  for header in $SPOOF_HEADERS; do
    curl_args+=(--header "${header}: ${SPOOF_ADDRESS}")
  done
  curl_args+=(--header "forwarded: for=${SPOOF_ADDRESS}")

  printf '\nSpoofed forwarding headers (informational; a header that passes a client value through cannot be trusted):\n'
  status=$(probe_get "$body" "$headers" "${curl_args[@]}")
  if ! is_status_200 "$status" || ! is_json_probe "$body"; then
    printf '  request with spoofed headers answered %s; no report\n' "$status"
    return
  fi

  jq -r --arg spoof "$SPOOF_ADDRESS" --arg names "$SPOOF_HEADERS forwarded" "${JQ_DEFS}"'
    . as $probe
    | (($names | split(" ")[] | select(length > 0)) as $name
        | $probe.forwardingHeaders[$name] as $value
        | "  \($name): " + (
            if $value == null then "absent"
            elif $name == "x-forwarded-for" or $name == "x-original-for" then
              ($value | entries | [to_entries[] | select(.value == $spoof) | .key]) as $hits
              | if ($hits | length) == 0 then "client value dropped"
                else "client value passed through at position \($hits | joined) of \($value | entries | length)"
                end
            elif ($value | contains($spoof)) then "client value passed through"
            else "client value replaced"
            end)),
      "  remote address: " + (
        if $probe.remoteAddress == null then "absent"
        elif $probe.remoteAddress == $spoof then "client value passed through"
        else "not taken from the client"
        end)
  ' "$body"
}

main() {
  case "${1:-}" in
    -h | --help)
      usage
      exit 0
      ;;
    "") ;;
    *) die "unexpected argument (see --help)" ;;
  esac

  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v jq >/dev/null 2>&1 || die "jq is required"

  local base_url=${BASE_URL:-}
  [ -n "$base_url" ] || die "BASE_URL is not set"
  case "$base_url" in
    https://*) ;;
    http://localhost | http://localhost:* | http://localhost/* | http://127.0.0.1 | http://127.0.0.1:* | http://127.0.0.1/*) ;;
    *) die "BASE_URL must start with https:// (plain http only for localhost)" ;;
  esac
  PROBE_URL="${base_url%/}/api/health/probe"
  TIMEOUT=${PROBE_TIMEOUT:-60}
  case "$TIMEOUT" in
    '' | *[!0-9]*) die "PROBE_TIMEOUT must be a whole number of seconds" ;;
  esac

  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/api-probe.XXXXXX")
  trap cleanup EXIT
  local jar="$TMP_DIR/cookies.txt"
  local status cookies cookie_count

  printf 'API platform probe: cookie round trip and client-IP headers\n\n'

  # Step 1: empty jar. The probe must set the cookie and must not have received one.
  status=$(probe_get "$TMP_DIR/first.json" "$TMP_DIR/first.headers" --cookie-jar "$jar")
  check "first request answered 200 (got ${status})" is_status_200 "$status"
  if ! is_status_200 "$status" || ! is_json_probe "$TMP_DIR/first.json"; then
    case "$status" in
      000) fail "first request reached the API (request failed or timed out)" ;;
      404) fail "first response is a probe body (404: is Diagnostics__ProbeEnabled off?)" ;;
      *) fail "first response is a probe body" ;;
    esac
    printf '\nResult: fail (%s of %s checks failed)\n' "$FAILURES" "$CHECKS"
    exit 1
  fi
  check "API received no cookie on the first request" json_false "$TMP_DIR/first.json" '.cookieReceived'

  cookies=$(probe_set_cookies "$TMP_DIR/first.headers")
  cookie_count=0
  if [ -n "$cookies" ]; then
    cookie_count=$(printf '%s\n' "$cookies" | wc -l | tr -d '[:space:]')
  fi
  check "exactly one ${COOKIE_NAME} cookie set (got ${cookie_count})" [ "$cookie_count" = "1" ]
  if [ "$cookie_count" = "1" ]; then
    check_cookie_attributes "$cookies"
  fi
  check "client stored the cookie" jar_has_cookie "$jar"

  # Step 2: same jar. The cookie must travel back through the proxy to the API.
  status=$(probe_get "$TMP_DIR/second.json" "$TMP_DIR/second.headers" --cookie "$jar" --cookie-jar "$jar")
  check "second request answered 200 (got ${status})" is_status_200 "$status"
  check "API received the cookie on the second request (cookieReceived)" json_true "$TMP_DIR/second.json" '.cookieReceived'

  if has_no_store "$TMP_DIR/first.headers"; then
    printf '\nCache-Control no-store reaches the client: yes\n'
  else
    printf '\nCache-Control no-store reaches the client: no\n'
  fi
  report_forwarding_headers "$TMP_DIR/first.json"
  report_spoofing "$TMP_DIR/spoof.json" "$TMP_DIR/spoof.headers"

  if [ "$FAILURES" -gt 0 ]; then
    printf '\nResult: fail (%s of %s checks failed)\n' "$FAILURES" "$CHECKS"
    exit 1
  fi
  printf '\nResult: pass (%s checks)\n' "$CHECKS"
}

main "$@"
