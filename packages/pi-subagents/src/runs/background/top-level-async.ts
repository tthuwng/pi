interface AsyncOverrideParams {
	async?: boolean;
	clarify?: boolean;
}

interface WorkflowExpansionState {
	expanded?: boolean;
}

export function applyForceTopLevelAsyncOverride<T extends AsyncOverrideParams>(
	params: T,
	depth: number,
	forceTopLevelAsync: boolean,
): T {
	if (!(depth === 0 && forceTopLevelAsync)) return params;
	return { ...params, async: true, clarify: false };
}

export function applyForceTopLevelAsyncOverrideForExecution<
	T extends AsyncOverrideParams,
>(
	params: T,
	depth: number,
	forceTopLevelAsync: boolean,
	workflowExpansion: WorkflowExpansionState,
): T {
	if (workflowExpansion.expanded === true) return params;
	return applyForceTopLevelAsyncOverride(params, depth, forceTopLevelAsync);
}
