#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
agent_dir=${PI_AGENT_DIR:-"$HOME/.pi/agent"}
timestamp=$(date +%Y%m%d-%H%M%S)
backup_dir="$agent_dir/config-backups/$timestamp"

mkdir -p "$agent_dir"

link_config() {
	name=$1
	source="$repo_dir/$name"
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
link_config mcp.json
link_config AGENTS.md
link_config package.json

link_directory() {
	name=$1
	source="$repo_dir/$name"
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

link_directory extensions
link_directory packages
link_directory prompts

link_launcher() {
	source="$repo_dir/bin/pi"
	target="$HOME/.local/bin/pi"

	if [ -L "$target" ]; then
		current=$(readlink "$target")
		if [ "$current" = "$source" ]; then
			printf 'linked: %s\n' "$target"
			return
		fi
		mkdir -p "$backup_dir"
		mv "$target" "$backup_dir/pi.previous-link"
	elif [ -e "$target" ]; then
		mkdir -p "$backup_dir"
		mv "$target" "$backup_dir/pi"
	fi

	ln -s "$source" "$target"
	printf 'linked: %s -> %s\n' "$target" "$source"
}

link_launcher

link_agents() {
	name=agents
	source="$repo_dir/$name"
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

link_agents

link_skills() {
	name=skills
	source="$repo_dir/$name"
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

link_skills

cat <<'EOF'

Linked credential-free Pi settings.
Local account routing and runtime state remain local:
  ~/.pi/agent/auth.json
  ~/.pi/agent/multi-pass.json
  ~/.pi/agent/models-store.json
  ~/.pi/agent/npm/
EOF
