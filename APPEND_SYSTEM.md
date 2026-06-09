# Environment

## System

- Machine: ThinkPad X1 Carbon Gen 13, x86_64, Arch Linux
- Wayland: sway; use sway config syntax
- Clipboard: `wl-copy` / `wl-paste`
  - To copy an exact command: `printf '%s\n' '<command>' | wl-copy`
- IDE: Neovim
- Terminal: Foot
- Package manager: `pacman` / `yay`; not apt/brew

## Stack

- Python: `uv`, `basedpyright`, `ruff`
- TypeScript: `pnpm`, `vtsls`, `eslint`, `prettier`
- Bash: `shellcheck`
- Containers: `docker`, `docker-compose`, `docker-buildx`
- Database: local PostgreSQL is installed
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
