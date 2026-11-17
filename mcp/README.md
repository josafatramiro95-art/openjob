# Optional local MCP package

This package is an optional developer tool for GitHub-backed pull requests. People do not need to install it to search OpenJob or publish a talent profile.

Read tools use <https://openjob.softprobe.ai/index.json>. They do not need a token.

Write tools need `GITHUB_TOKEN` for the person. The server opens or updates one pull request as that login. It forks the repository when that login cannot push. It sets the filename, `posted_by`, `github`, and `owners`. It does not push to the default branch.

This package is not published to PyPI yet. Install it from git.

```
uvx --from git+https://github.com/softprobe/openjob.git openjob-mcp
```

The same install provides the `openjob` command:

```
uvx --from git+https://github.com/softprobe/openjob.git openjob search-jobs "reliability"
```

From a checkout of this repository:

```
PYTHONPATH=mcp:cli python -m openjob_mcp
PYTHONPATH=mcp:cli python -m openjob_cli search-jobs "reliability"
```

## Tools

| Tool | Token | What it does |
| --- | --- | --- |
| `search_jobs` | No | `query` plus `filters`: `location`, `remote`, `language`, `tag`, `employment_type` |
| `get_job` | No | One job by path or permalink |
| `search_talent` | No | `query` plus `filters`, including `open_to` |
| `get_talent` | No | One profile by GitHub login |
| `validate_post` | No | `kind` (`job`, `talent`, or `company`) and Markdown. No pull request |
| `create_or_update_post` | Yes | `kind` and `fields`. Builds the file and opens the pull request. `dry_run` returns the file only |
| `close_job` | Yes | Pull request that removes a job. `dry_run` returns the path only |

`fields` contains the front matter plus a required Markdown `body`. On a new post the server sets `posted_by` or `github` to the token's login. A company page gets that login in `owners`.

For a talent post, keep discovery details in the front matter and put résumé evidence in the Markdown body under `## About`, `## Experience`, and `## Education`. Put a concise factual summary first. Use flat bullet lists for experience evidence. Use only facts the person supplied and omit missing details. Omit Education when the person has no education information or does not want it shown. Do not include an email, phone number, WeChat ID, WhatsApp handle, or Telegram handle.

## Claude Desktop

Add this to `claude_desktop_config.json`. Put the person's token in the environment. Leave it out when the agent only searches.

```json
{
  "mcpServers": {
    "openjob": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/softprobe/openjob.git", "openjob-mcp"],
      "env": {
        "GITHUB_TOKEN": "github_pat_replace_me"
      }
    }
  }
}
```

## Cursor

Add the same `mcpServers` entry to `~/.cursor/mcp.json`.

## Hosted remote MCP

For no-install search and talent-profile publishing, connect to `https://openjob.softprobe.ai/api/mcp`. It exposes `get_dataset`, `list_jobs`, `get_job`, `list_talent`, `get_talent`, `create_talent`, and `delete_talent`. The write tools use the same schemas as the HTTP API at `https://openjob.softprobe.ai/api/v1/` and need no account or API key. `create_talent` requires explicit approval of the exact public profile fields, the CC BY 4.0 license, 180-day expiry, and the fact that deletion cannot recall copies already downloaded; it returns a private delete token once.

The remote MCP accepts structured discovery fields and `body_markdown` résumé evidence. It does not accept resume file uploads. For PDF, Word, or LinkedIn source material, agents should extract the API schema fields, ask only for material missing required values, show the exact Markdown profile, and get approval before creating it. The profile is public under CC BY 4.0 and expires after 180 days.

The Python package below speaks stdio and provides separate GitHub-backed pull request tools. Use it only when developing or choosing the repository workflow; it is not needed for profile publishing.

## Command line

`cli/` is the `openjob` command in this same package. `search-jobs`, `get-job`, `search-talent`, `get-talent`, and `validate` need no token. `post` and `close` need `GITHUB_TOKEN` unless you pass `--dry-run`.
