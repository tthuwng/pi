import { readBridgePath } from "./bridge.js";
import { type PiCopyConfig, resolvePiCopyConfig } from "./config.js";
import { installPasteImageBridge, type PasteImageEditor } from "./paste-handler.js";

export * from "./bridge.js";
export * from "./config.js";
export * from "./paste-handler.js";

type EditorFactory = (tui: unknown, theme: unknown, keybindings: unknown) => PasteImageEditor;

interface PiCopySessionContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		getEditorComponent(): EditorFactory | undefined;
		setEditorComponent(factory: EditorFactory): void;
		pasteToEditor(text: string): void;
		notify(message: string, type: "warning"): void;
	};
}

interface PiCopyExtensionAPI {
	on(event: "session_start", handler: (event: unknown, ctx: PiCopySessionContext) => void): void;
}

export function createPiCopy(config: PiCopyConfig = {}): (pi: PiCopyExtensionAPI) => void {
	return (pi) => piCopy(pi, config);
}

export default function piCopy(pi: PiCopyExtensionAPI, config: PiCopyConfig = {}): void {
	const resolvedConfig = resolvePiCopyConfig(config);

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		const previousFactory = ctx.ui.getEditorComponent();
		if (!previousFactory) return;

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previousFactory(tui, theme, keybindings);

			installPasteImageBridge(editor, {
				readPath: () =>
					readBridgePath({
						command: resolvedConfig.command,
						cwd: ctx.cwd,
						timeoutMs: resolvedConfig.timeoutMs,
					}),
				pasteToEditor: (text) => ctx.ui.pasteToEditor(text),
				notify: (message) => ctx.ui.notify(message, "warning"),
				notifyOnFailure: resolvedConfig.notifyOnFailure,
			});

			return editor;
		});
	});
}
