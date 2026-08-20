import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const WRAPPERS = new Set(["env", "exec", "nice", "sudo", "doas"]);

function commandWords(command: string): string[] {
	return command
		.replace(/\\\r?\n/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

function firstCommand(words: string[]): { name: string; args: string[] } | null {
	let index = 0;
	while (index < words.length) {
		const word = words[index];
		if (WRAPPERS.has(word)) {
			index++;
			continue;
		}
		if (word === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
			index++;
			continue;
		}
		return { name: word.split("/").pop() ?? word, args: words.slice(index + 1) };
	}
	return null;
}

/**
 * Return a reason when a shell command matches the non-overridable safety floor.
 *
 * ponytail: token-based checks cover known catastrophic commands; use a shell
 * parser only if command-obfuscation becomes a demonstrated risk.
 */
export function hardlineReason(command: string): string | null {
	const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();

	if (/:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(normalized)) {
		return "fork bomb";
	}

	if (/(?:curl|wget)\b[^;&|]*\|\s*(?:(?:sudo|doas)\s+)?(?:ba|z|fi)?sh\b/.test(normalized)) {
		return "remote script piped to a shell";
	}

	for (const segment of normalized.split(/&&|\|\||[;\n]/)) {
		const parsed = firstCommand(commandWords(segment));
		if (!parsed) continue;

		if (parsed.name === "mkfs" || parsed.name.startsWith("mkfs.")) {
			return "filesystem format command";
		}

		if (parsed.name === "rm") {
			const flags = parsed.args.filter((arg) => arg.startsWith("-")).join("");
			const removesRecursively = flags.includes("r") || flags.includes("R") || flags.includes("recursive");
			const forces = flags.includes("f") || flags.includes("F") || flags.includes("force");
			const targetsRoot = parsed.args.some((arg) => arg === "/" || arg === "/*");
			if (removesRecursively && forces && targetsRoot) return "recursive root deletion";
		}

		if (parsed.name === "dd") {
			const input = parsed.args.find((arg) => arg.startsWith("if="));
			const output = parsed.args.find((arg) => arg.startsWith("of="));
			if (
				input === "if=/dev/zero" &&
				output &&
				/^of=\/dev\/(?:sd|vd|xvd|nvme|mmcblk|mapper)/.test(output)
			) {
				return "zeroing a block device";
			}
		}
	}

	return null;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (!isToolCallEventType("bash", event)) return;
		const reason = hardlineReason(event.input.command);
		if (!reason) return;
		return {
			block: true,
			terminate: true,
			reason: `Blocked by safety floor: ${reason}.`,
		};
	});
}
