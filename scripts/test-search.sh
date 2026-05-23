#!/usr/bin/env bash
# End-to-end smoke test for chromie:
#   1) start a headed browser daemon
#   2) open duckduckgo.com  (Google's bot-detection rejects automated submits, see commit history)
#   3) type a search query, submit
#   4) wait for the results URL
#   5) export the full results-page DOM HTML to a file
#
# Usage:
#   scripts/test-search.sh                       # default query, write ./search.html
#   scripts/test-search.sh out.html "claude code"
#
# Requires: chromie on PATH, jq.

set -euo pipefail

OUT_FILE="${1:-./search.html}"
QUERY="${2:-chromie chrome devtools mcp}"
NAME="chromie-test-$$"

# Extract the raw return value from evaluate_script's markdown-wrapped JSON envelope:
#   structuredContent.message = "Script ran on page and returned:\n```json\n<value>\n```"
extract_eval_result() {
  jq -r '.structuredContent.message' \
    | awk 'BEGIN{out=0} /^```json$/{out=1; next} /^```$/{out=0} out' \
    | jq -r .
}

cleanup() {
  echo "==> cleanup: stopping browser $NAME"
  chromie browser stop "$NAME" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> 1) start headed browser ($NAME)"
chromie browser start --headed --name "$NAME" >/dev/null

echo "==> 2) open duckduckgo.com"
chromie --browser "$NAME" devtools new_page "https://duckduckgo.com/" >/dev/null
sleep 1

echo "==> 3) fill search box: \"$QUERY\""
QJSON=$(jq -n --arg q "$QUERY" '$q')
SEARCH_JS="() => {
  const i = document.querySelector('input[name=\"q\"]');
  if (!i) throw new Error('search input not found');
  i.focus();
  i.value = $QJSON;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.form.submit();
  return { submitted: true };
}"
chromie --browser "$NAME" devtools evaluate_script "$SEARCH_JS" >/dev/null

echo "==> 4) wait for results URL"
for _ in $(seq 1 20); do
  url=$(chromie --output-format json --browser "$NAME" devtools evaluate_script '() => location.href' 2>/dev/null | extract_eval_result || true)
  if [[ "$url" == *"q="* ]]; then
    echo "    landed on: $url"
    break
  fi
  sleep 0.5
done
# Give SERP a beat to finish rendering.
sleep 2

echo "==> 5) export full DOM HTML to $OUT_FILE"
chromie --output-format json --browser "$NAME" devtools evaluate_script \
  '() => document.documentElement.outerHTML' \
  | extract_eval_result > "$OUT_FILE"

SIZE=$(wc -c < "$OUT_FILE" | tr -d ' ')
LINES=$(wc -l < "$OUT_FILE" | tr -d ' ')
echo "==> done. $OUT_FILE — $SIZE bytes, $LINES lines"
echo
echo "    title in DOM:"
grep -o '<title>[^<]*</title>' "$OUT_FILE" | head -1 | sed 's/^/      /'
echo "    first 5 result-looking links:"
grep -oE 'href="https?://[^"]*"' "$OUT_FILE" \
  | grep -vE 'duckduckgo\.com|duck\.co|spreadprivacy|w3\.org|github\.com/duckduckgo' \
  | head -5 | sed 's/^/      /'
