# modelhub-port — Build Report

MCP Rebuild 100. Clean-room rebuild of the hosted Hugging Face MCP
server, built from the public tool spec captured in
`harness/fixtures/huggingface-tools-original.json`. The fixture's
`_source` is labelled docs-derived: the hosted-remote surface is
reproduced against the public Hub API (`https://huggingface.co/api`),
not hand-probed from a live hosted server. Local build only — nothing
pushed or published, and no live network call was made or claimed.

Identity: repo `modelhub-port`, npm `@reneturcios/modelhub-port`,
MCP name `io.github.CloudCorpRecords/modelhub-port`, version `0.1.0`.

## Tools (7/7)

| Tool | Upstream |
| --- | --- |
| `hf_whoami` | `GET /api/whoami-v2` — the only tool that needs a token |
| `hub_repo_details` | `GET /api/{models\|datasets\|spaces}/{id}` (optional `revision` query param) |
| `hub_repo_search` | `GET /api/{models\|datasets\|spaces}` with `search`, `author`, `sort`, `limit`, `direction` |
| `paper_search` | `GET /api/papers/search?q=&limit=` |
| `hf_doc_search` | `GET https://huggingface.co/api/docs/hub/search?q=` (docs-derived, see Gaps) |
| `hf_doc_fetch` | Fetch one `huggingface.co/docs` page, HTML stripped to text |
| `list_repo_files` | `GET /api/{type}/{id}/tree/{revision}` (default `main`, optional sub-path) |

Omitted hosted-only tools (recorded in the fixture `_source`):
dynamic_space / Gradio tool invocation, jobs and uv jobs, buckets,
collections management writes, and model/dataset upload writes.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `modelhub-port: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Search and inspect Hugging Face
  models, datasets, spaces, papers and docs." = **74 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/modelhub-port:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/modelhub-port"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`whoami`, `details`, `search`,
  `papers`, `doc-search`, `doc-fetch`, `files`, `mcp`, `--version`;
  exit 2 usage / 1 lookup error), `src/mcp.ts`, `src/types.ts`,
  `src/hub.ts` (core logic, `VERSION = "0.1.0"`)
- `test/hub.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to modelhub-port)

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the fleet precedent: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that break exact schema parity. Zod
  still validates every `tools/call`.
- **Keyless-first env behaviour:** `HF_TOKEN` is OPTIONAL. When set
  it is sent as `Authorization: Bearer <token>`; when absent every
  public tool proceeds anonymously and never errors for a missing
  token (unit-tested both ways: no Authorization header without a
  token, Bearer header with one). The alias
  `HUGGING_FACE_HUB_TOKEN` is implemented as a fallback when
  `HF_TOKEN` is unset. Only `hf_whoami` — which inherently needs
  auth — returns an honest error naming `HF_TOKEN` when the token
  is absent, and also names `HF_TOKEN` when the API answers 401.
- All HTTP flows through an injectable `FetchFn` (types.ts). The
  test suite uses a fake fetch returning hand-written fixtures in
  the documented Hub response shapes — **no live call was performed
  during this build** (VM egress blocked), so behaviour against the
  live API's current responses is unverified (see Gaps).
- `hf_doc_fetch` refuses non-docs and off-site URLs before fetching,
  and strips pages with a small HTML-to-text pass (script/style
  removed, block tags become line breaks, common entities decoded).

## Verification (foreground, real output)

Note: an early backgrounded exec delivery summary for this build
invented test results that were never run; every figure below was
re-verified in the foreground from real tool output / process.log.

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
Canonical `dist/` produced by stock tsc, including `dist/cli.js`.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 20
ℹ pass 20
ℹ fail 0
```
Covers: token reading (HF_TOKEN preferred / alias honoured / absent
/ blank), repo-type normalisation and rejection, whoami
missing-token and 401 errors naming HF_TOKEN plus Bearer parsing,
repo details anonymous vs Bearer requests and dataset routing with
revision, search query building with limit default/clamp, tree
listing at main and at revision+sub-path, papers nested-record
unwrapping, docs-search parsing and limit capping, HTML stripping,
docs-fetch URL validation, and HTTP-500 propagation.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"modelhub-port","version":"0.1.0"}`.
A live stdio `tools/call` of `hf_whoami` with no token returned
`isError: true` with text naming `HF_TOKEN` — the honest
missing-key path, verified end-to-end. No live Hub call was run.

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/huggingface-tools-original.json \
    --rebuild "stdio:node .../builds/modelhub-port/dist/cli.js mcp" \
    --out .../builds/modelhub-port/parity-out
verdict=PASS parity_pct=100.0 original_tools=7 rebuild_tools=7 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity.json`: parity_pct 100.0, identical_tools 7 == total 7.
Original side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from libdocs' and edited with the
file edit tool: top-level `name`, root package `name`, and root
package `bin` key changed libdocs -> modelhub-port (dependency
ranges are identical, so the tree is unchanged). **Clean
regeneration (no `node_modules` present) is required before
publish**; do not publish from this lockfile as-is. `node_modules`
here is a `cp -a` copy of libdocs' (ownership-preservation warnings
during the copy were cosmetic; `.bin/tsc` / `.bin/tsx` verified
working).

## Gaps / honest notes

- No live Hugging Face call was made (egress blocked, no token in
  this VM). Request shaping, auth headers, and response parsing are
  proven against fake fetches only; upstream payload drift is
  unverified until the publish wave.
- **hf_doc_search is the riskiest surface:** its upstream
  (`https://huggingface.co/api/docs/hub/search?q=`) is the endpoint
  the hosted docs tooling is documented to use, but its exact live
  request/response contract could not be probed here. The parser
  tolerates array / `results` / `hits` / `documents` envelopes
  without inventing data. **First check at publish-wave live smoke.**
- `hub_repo_details` passes `revision` as a query parameter; if the
  live API expects revision in the path for a given repo kind, that
  is a one-line change at live smoke.
- Paper search unwraps both flat paper records and the
  `{paper: {...}}` daily-papers envelope; live shape drift is
  unverified.
- The fixture is docs-derived, not hand-probed: parity proves the
  rebuild matches the documented public spec captured in the
  fixture, not a live hosted server.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
