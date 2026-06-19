import { quotePathForPaste, type BridgePathResult } from "./bridge.js";

export interface PasteImageEditor {
	onPasteImage?: () => void | Promise<void>;
}

export interface PasteImageBridgeOptions {
	readPath: () => BridgePathResult | Promise<BridgePathResult>;
	pasteToEditor: (text: string) => void;
	notify: (message: string) => void;
	notifyOnFailure: boolean;
}

export function installPasteImageBridge(
	editor: PasteImageEditor,
	options: PasteImageBridgeOptions,
): void {
	const previousPasteImage = editor.onPasteImage;
	editor.onPasteImage = async () => {
		const result = await options.readPath();
		if (result.ok) {
			options.pasteToEditor(quotePathForPaste(result.path));
			return;
		}

		if (options.notifyOnFailure) options.notify(messageForFailure(result));
		await previousPasteImage?.();
	};
}

function messageForFailure(result: Exclude<BridgePathResult, { ok: true }>): string {
	switch (result.reason) {
		case "empty":
			return "pi-copy: clipboard bridge did not return an image path";
		case "timeout":
			return "pi-copy: clipboard bridge command timed out";
		case "spawn-error":
			return `pi-copy: clipboard bridge command could not run: ${result.error}`;
		case "command-failed":
			return `pi-copy: clipboard bridge command failed with status ${result.status}`;
		case "missing":
			return `pi-copy: bridge path does not exist: ${result.path}`;
		case "not-file":
			return `pi-copy: bridge path is not a file: ${result.path}`;
	}
}
