# modelhub-port

modelhub-port lets an agent explore the Hugging Face Hub without
leaving its tools: look up who a token belongs to, inspect a model,
dataset, or space in detail, search across all three repository
kinds, list a repository's files, search the daily papers, and
search or fetch pages from the Hugging Face documentation. It works
from the command line or as an MCP server.

No token is needed to get started. The public Hub endpoints work
anonymously, so every tool except `hf_whoami` runs keyless. When
`HF_TOKEN` is set (the `HUGGING_FACE_HUB_TOKEN` alias is also
accepted), requests carry it as a Bearer token, which raises rate
limits and unlocks private or gated content the token can see.
`hf_whoami` is the one tool that needs a token, because its whole
job is to say whose token it is; without one it answers with an
error naming `HF_TOKEN`.

## Install

```bash
npx @reneturcios/modelhub-port search llama --limit 5
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/modelhub-port
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
# Whose token is configured? (requires HF_TOKEN)
modelhub-port whoami

# Repository details and file listings
modelhub-port details meta-llama/Llama-3.1-8B
modelhub-port details squad --type datasets
modelhub-port files meta-llama/Llama-3.1-8B

# Search models (default), datasets, or spaces
modelhub-port search "text generation" --sort downloads --limit 10
modelhub-port search --type datasets --author google

# Papers and documentation
modelhub-port papers "retrieval augmented generation"
modelhub-port doc-search "fine-tuning"
modelhub-port doc-fetch https://huggingface.co/docs/transformers/index

modelhub-port --version
```

Exit codes: `0` on success, `1` when a lookup fails (the error
names the problem, including the HTTP status when the Hub answers
with one), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/modelhub-port mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "modelhub-port": {
      "command": "npx",
      "args": ["-y", "@reneturcios/modelhub-port", "mcp"],
      "env": {
        "HF_TOKEN": "your-token-if-you-have-one"
      }
    }
  }
}
```

The `env` block is optional — leave it out entirely to run keyless.

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `hf_whoami` | _(none)_ | The account the configured `HF_TOKEN` belongs to. Errors naming `HF_TOKEN` when no token is set. |
| `hub_repo_details` | `repo_id` (string, required), `repo_type` (string, optional), `revision` (string, optional) | Author, downloads, likes, dates, tags, and file names for one model, dataset, or space. |
| `hub_repo_search` | `search`, `repo_type`, `author`, `sort`, `limit`, `direction` (all optional) | A ranked list of matching repositories of the chosen kind. |
| `paper_search` | `query` (string, required), `limit` (number, optional) | Papers matching the query, with authors, dates, and summaries. |
| `hf_doc_search` | `query` (string, required), `limit` (number, optional) | Matching pages from the Hugging Face documentation. |
| `hf_doc_fetch` | `url` (string, required) | The text of one `huggingface.co/docs` page, with markup stripped. |
| `list_repo_files` | `repo_id` (string, required), `repo_type`, `revision`, `path` (optional) | The file tree of a repository at a revision, defaulting to `main`. |

Hosted-only surfaces are out of scope for this rebuild: invoking
Gradio spaces as tools, running jobs, managing buckets or
collections, and upload/write operations are not included.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
