import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export const ANSI_RE =
	/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
export const ANSI_FG_RESET = "\x1b[39m";
export const ANSI_BLINK = "\x1b[5m";
export const ANSI_BLINK_RESET = "\x1b[25m";
export const EDITOR_RULE_ACCENT = "\x1b[38;2;189;174;147m";
export const USER_MESSAGE_ACCENT = "\x1b[38;2;131;165;152m";

export function stripAnsi(value: string): string {
	return value.replace(ANSI_RE, "");
}

export function fitLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}
