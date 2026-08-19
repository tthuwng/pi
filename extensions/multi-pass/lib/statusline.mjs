export function formatCodexWeeklyStatus(snapshot) {
	const weekly = snapshot?.weekly;
	if (!weekly || typeof weekly.usedPercent !== "number" || !Number.isFinite(weekly.usedPercent)) {
		return "Codex unavailable";
	}

	const used = Math.max(0, Math.min(100, Math.round(weekly.usedPercent)));
	return `Codex ${used}% used`;
}

export function formatCodexSessionStatus({ mode, account, session }) {
	return `${mode} · ${account} · ${session}`;
}
