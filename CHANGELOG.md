# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `whoami`, `details`, `search`, `papers`, `doc-search`,
  `doc-fetch`, and `files` commands over the public Hugging Face
  Hub API.
- MCP server (`modelhub-port mcp`, stdio) with seven tools:
  `hf_whoami`, `hub_repo_details`, `hub_repo_search`, `paper_search`,
  `hf_doc_search`, `hf_doc_fetch`, and `list_repo_files`.
- Keyless-first: public Hub endpoints work without a token.
  `HF_TOKEN` (alias `HUGGING_FACE_HUB_TOKEN`) is optional and sent
  as a Bearer token when set; only `hf_whoami` requires it.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
