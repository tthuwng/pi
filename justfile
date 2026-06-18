set shell := ["bash", "--noprofile", "--norc", "-cu"]

default:
    just --list

setup:
    ./setup.sh

check:
    bash -n setup.sh scripts/doctor.sh
    node --check scripts/check-mcp.mjs
    node -e 'for (const file of ["package.json", "package-lock.json", "mcp-servers/tree-sitter/package.json", "mcp-servers/tree-sitter/package-lock.json", "settings.json", "mcp.json", "models.json", "permissions.json", "keybindings.json"]) JSON.parse(require("fs").readFileSync(file, "utf8"))'

doctor:
    ./scripts/doctor.sh
