#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
agent_dir=${PI_AGENT_DIR:-"$HOME/.pi/agent"}
timestamp=$(date +%Y%m%d-%H%M%S)
backup_dir="$agent_dir/config-backups/$timestamp"

mkdir -p "$agent_dir"

link_config() {
	name=$1
	source="$repo_dir/agent/$name"
	target="$agent_dir/$name"

	if [ -L "$target" ]; then
		current=$(readlink "$target")
		if [ "$current" = "$source" ]; then
			printf 'linked: %s\n' "$target"
			return
		fi
		mkdir -p "$backup_dir"
		mv "$target" "$backup_dir/$name.previous-link"
	elif [ -e "$target" ]; then
		mkdir -p "$backup_dir"
		mv "$target" "$backup_dir/$name"
	fi

	ln -s "$source" "$target"
	printf 'linked: %s -> %s\n' "$target" "$source"
}

link_config settings.json

cat <<'EOF'

Linked credential-free Pi settings.
Local account routing and runtime state remain local:
  ~/.pi/agent/auth.json
  ~/.pi/agent/multi-pass.json
  ~/.pi/agent/models-store.json
  ~/.pi/agent/npm/
EOF
