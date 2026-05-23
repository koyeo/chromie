---
name: use-chromie
description: Drive a real Chrome browser from the shell via the `chromie` CLI (this repo's `packages/cli`) — open pages, click/fill/type, take screenshots, run JavaScript in the page, export DOM, capture network/console, run Lighthouse audits, record performance traces. Backed by `chrome-devtools-mcp` (puppeteer + CDP); exposes the upstream 36 tools as `chromie devtools <tool>` subcommands. Two modes — ephemeral one-shots (fresh Chrome per command) and persistent browser daemons (`chromie browser start`, state survives across commands). Use when the user wants to automate Chrome from a bash/Node script, scrape a JS-rendered page, capture a webapp screenshot, write a UI smoke test, extract DOM HTML, run Lighthouse, or trace a page's Core Web Vitals. NOT for: long-running test suites (use Playwright), large-scale parallel scraping (single-Chrome serialization), interactive REPL (no shell mode). Args (optional): a task description ("screenshot X", "scrape Y", "DOM of Z after login").
---

# use-chromie

`chromie` is this monorepo's CLI in `packages/cli/`. After `make install` it lives at `~/.local/bin/chromie`. Full command shape:

```
chromie [--browser <id>] [--output-format text|json] <subcommand> ...
```

## Architecture (so you know the seams)

```
chromie CLI (commander, auto-generates devtools subcommands from MCP listTools)
  └─ MCP Client
        ↓ (InMemoryTransport for ephemeral; unix-socket NDJSON for --browser daemon)
     chrome-devtools-mcp createMcpServer
        └─ Tool handler → Puppeteer → CDP → Chrome
```

List all tools: `chromie devtools --help`. Single-tool schema: `chromie devtools <name> --help`.

## Two modes

### Ephemeral (default — no `--browser` flag)

Each call launches a fresh headless Chrome, runs the tool, exits. No state across calls.

Use for: one-shot screenshots, single Lighthouse audit, quick JS evaluation against a URL, simple scrapes that fit in one command.

```bash
chromie devtools new_page "https://example.com"          # opens, exits — useless on its own
chromie devtools evaluate_script '() => fetch("https://api.x/").then(r => r.json())'
chromie devtools lighthouse_audit --mode navigation
```

You **cannot** chain ephemeral commands against the same page — each one is a new Chrome. For chained workflows use a persistent browser.

### Persistent browser (use this whenever > 1 command)

A background daemon holds Chrome alive. Address it via `--browser <id>` on every devtools call.

```bash
B=$(chromie browser start --name dev)            # uuid v7; --name optional friendly handle
chromie browser start --headed --name dev        # visible Chrome window (debugging)

chromie --browser dev devtools new_page "https://example.com"
chromie --browser dev devtools list_pages        # cookies/tabs/scroll persist
chromie --browser dev devtools select_page 2     # switch implicit "selected" tab
chromie --browser dev devtools take_screenshot --filePath ./s.png
chromie --browser dev devtools evaluate_script '() => document.title'

chromie browser list
chromie browser stop dev
chromie browser stop --all
```

Per browser daemon:
- One real Chrome process (each `browser start` = a separate Chrome instance with its own profile)
- Multiple tabs survive (`new_page` adds; `select_page` switches the active tab — operations target the selected tab implicitly)
- Cookies/localStorage/login session retained across commands
- Headed window stays open between commands → you can manually intervene (CAPTCHA, login, file picker)
- Default idle-timeout 30 min — daemon self-exits if no commands arrive. `--idle-timeout 0` disables

Names must be unique among running daemons. Re-using a name errors out (we made this strict on purpose — addresses an earlier UX bug).

True parallelism = multiple browsers (each is a separate Chrome). Within one browser, commands are serialized by upstream's `toolMutex`.

## Tool catalog (curated subset; full list via `chromie devtools --help`)

Page lifecycle:
- `new_page <url>` — open new tab, becomes selected
- `list_pages` / `select_page <id>` / `close_page <id>`
- `navigate_page --type url --url <u>` (also `back`/`forward`/`reload`)
- `wait_for '["text1","text2"]' --timeout 10000` — block until any text appears

DOM interaction (most need a uid from `take_snapshot` first):
- `take_snapshot` — a11y tree with uids; **use these uids, NOT CSS selectors, for click/fill/...**
- `click <uid>` / `hover <uid>` / `drag <from_uid> <to_uid>`
- `fill <uid> <value>` — single input
- `fill_form --elements '[{uid,value},...]'` — batch (prefer over multiple `fill` calls)
- `type_text <text>` — into focused input
- `press_key <key>` — `Enter`, `Tab`, `Control+A`, etc.
- `upload_file <uid> --filePath <p>`
- `handle_dialog --action accept|dismiss`

Data extraction:
- `evaluate_script '<async () => ...>'` — run JS in the page, return JSON-serializable value
- `take_screenshot --filePath x.png [--fullPage true]`
- `list_network_requests` / `get_network_request --reqid X`
- `list_console_messages` / `get_console_message --msgid X`

Performance & audits:
- `performance_start_trace --reload true --autoStop true` / `performance_stop_trace`
- `performance_analyze_insight --insightName <n> --insightSetId <id>`
- `lighthouse_audit --mode navigation` (excludes perf — use trace for that)

Emulation:
- `emulate --viewport 375x812,mobile,touch --networkConditions "Slow 3G" --colorScheme dark --geolocation "37.7,-122.4"`
- `resize_page <w> <h>`

## Output format + the evaluate_script extraction recipe

Default is human-readable markdown. For programmatic consumption use `--output-format json`:

```bash
chromie --output-format json devtools list_pages | jq '.structuredContent.pages'
```

`evaluate_script` is the awkward one — its return value comes wrapped in markdown fences inside the message field. Unwrap it:

```bash
extract_eval_result() {
  jq -r '.structuredContent.message' \
    | awk 'BEGIN{out=0} /^```json$/{out=1; next} /^```$/{out=0} out' \
    | jq -r .
}

TITLE=$(chromie --output-format json --browser dev devtools evaluate_script '() => document.title' | extract_eval_result)
```

## JS-string escaping for evaluate_script

Embedding a shell variable into JS source is fragile. Use `jq -n --arg` to JSON-encode the value, then interpolate:

```bash
QJSON=$(jq -n --arg q "$QUERY" '$q')          # "some query"  (a valid JS string literal)
JS="() => { document.querySelector('input[name=\"q\"]').value = $QJSON; }"
chromie --browser dev devtools evaluate_script "$JS"
```

## Reference end-to-end example

See `scripts/test-search.sh` for: start headed browser → open DDG → fill search box → submit → wait for results URL → export full DOM HTML to file. It covers the recipes above (extract_eval_result, JS escaping, JSON output, cleanup trap).

## Gotchas & limitations

- **Implicit selected-page state inside one browser.** Tool calls without explicit page targeting hit the last-selected tab. In scripts: `select_page <id>` before each branch.
- **Serial execution within one browser** (upstream's `toolMutex`). For real parallel work use multiple browsers.
- **Each ephemeral command spawns a new in-process MCP** — ~200ms overhead per call + prints `turning off usage statistics` to stderr. Negligible in scripts, visible interactively.
- **`--pageId` per-tool arg not yet exposed in CLI** even though `chromie browser start --pageIdRouting` is accepted — daemon supports it but CLI doesn't introspect from the daemon yet. Use `select_page` for now.
- **Anti-bot detection.** Google challenges automated submits even in headed mode (lands on `/sorry/index`). DuckDuckGo / Bing are friendlier for demos.
- **Idle-timeout default 30 min.** Forgotten daemons self-exit. `--idle-timeout 0` keeps forever (watch RAM ~200 MB per Chrome).
- **`-o` is NOT a short alias** for `--output-format` — must spell out `--output-format`.

## Installation

```bash
make install                              # default ~/.local/bin (user, no sudo)
sudo make install PREFIX=/usr/local       # system-wide
make uninstall                            # remove shim
```

Requires pnpm + Node 20.19+. First-run downloads Chrome via Puppeteer cache to `~/.cache/puppeteer/`.

## When to pick something else

- **Long test suites with assertions / fixtures** → Playwright or Puppeteer directly
- **Scaled scraping** (many domains, retries, queues) → dedicated framework
- **No JS rendering needed** → `curl` + `htmlq`/`pup`
- **Real interactive REPL feel** → not yet; could add `chromie shell` later
