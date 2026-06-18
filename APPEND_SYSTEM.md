# Environment

## Terminal Workflow

- Primary workflow: kitty terminal -> tmux -> Vim/shell
- Terminal: kitty on the user's workstation; this remote shell may report a generic `$TERM`
- Multiplexer: tmux 3.6a
  - Prefix: `C-a`
  - Copy mode: vi keys
  - Mouse: enabled
  - History: 100000 lines
  - Color: tmux config enables `xterm-kitty:RGB` and truecolor overrides
  - Sessions are durable; prefer named tmux sessions for long-running or interactive work
- Editor: Vim, not Neovim
  - Do not assume `nvim`, Neovim sockets, or nvim MCP are available
  - Use tree-sitter, ast-grep, LSP, and direct file reads for code intelligence
- Clipboard: do not assume a host clipboard command until verified
- Package manager: verify the host before installing; do not assume pacman, apt, brew, or yay

## Stack

- Python: `uv`, `basedpyright`, `ruff`
- TypeScript: `pnpm`, `vtsls`, `eslint`, `prettier`
- Bash: `shellcheck`
- Containers: `docker`, `docker-compose`, `docker-buildx`
- Node: `nvm` + `pnpm`
- User version-control workflow: stacked PRs are user-run
- Cloud: `aws-cli` for S3, ECS, Secrets Manager, CloudFormation, logs
- Parsing: `tree-sitter-cli`

## Preferred CLIs

| Use                        | Prefer                  | Avoid                                 |
| -------------------------- | ----------------------- | ------------------------------------- |
| Python env/packages        | `uv`                    | `pip`, `venv`, `virtualenv`           |
| TypeScript packages        | `pnpm`                  | `npm`                                 |
| Structural search/refactor | `ast-grep`, `sg`        | grep/sed for code structure           |
| File discovery             | Pi `find` tool / `fd`   | shell `find` when Pi tools fit        |
| File display               | Pi `read` tool / `bat`  | `cat`                                 |
| Text replacement           | `sd`                    | `sed` for broad edits                 |
| Shell validation           | `shellcheck`            | manual-only shell review              |
| YAML/JSON                  | `yq` / targeted scripts | manual parsing                        |
| Benchmarks                 | `hyperfine`             | ad hoc `time`                         |
| Disk usage                 | `dua`                   | raw `du`                              |
| Terminal orchestration     | named `tmux` sessions   | detached mystery processes            |
| GitHub                     | `gh`                    | web UI                                |
| Structural git impact      | `gitnexus` / `sem`      | line diff only when structure matters |

## Language conventions

### Python

- Imports at top of file. Only exception: circular dependency resolution
- Logging levels:
  - `DEBUG`: lifecycle details
  - `INFO`: state changes
  - `WARNING`: real problems

### TypeScript

- Strict mode
- No `any`
- Import types with `type`

## Local check commands

- Python formatting: `ruff format`
- Python typecheck: `basedpyright`
- TypeScript formatting: `prettier`
- TypeScript lint/typecheck: `eslint`, project typecheck script, or `vtsls` diagnostics
- Bash validation: `shellcheck`
