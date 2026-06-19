import assert from "node:assert/strict";
import test from "node:test";

import { installPasteImageBridge, type PasteImageEditor } from "../src/index.js";

test("pastes bridge path and skips previous paste handler on success", async () => {
	const pasted: string[] = [];
	let fallbackCalls = 0;
	const editor: PasteImageEditor = {
		onPasteImage: () => {
			fallbackCalls++;
		},
	};

	installPasteImageBridge(editor, {
		readPath: () => ({ ok: true, path: "/tmp/clipboard image.png" }),
		pasteToEditor: (text: string) => pasted.push(text),
		notify: () => undefined,
		notifyOnFailure: true,
	});

	await editor.onPasteImage?.();

	assert.deepEqual(pasted, ['"/tmp/clipboard image.png"']);
	assert.equal(fallbackCalls, 0);
});

test("falls back to previous paste handler on bridge failure", async () => {
	const pasted: string[] = [];
	const notices: string[] = [];
	let fallbackCalls = 0;
	const editor: PasteImageEditor = {
		onPasteImage: () => {
			fallbackCalls++;
		},
	};

	installPasteImageBridge(editor, {
		readPath: () => ({ ok: false, reason: "command-failed", status: 127 }),
		pasteToEditor: (text: string) => pasted.push(text),
		notify: (message: string) => notices.push(message),
		notifyOnFailure: true,
	});

	await editor.onPasteImage?.();

	assert.deepEqual(pasted, []);
	assert.equal(fallbackCalls, 1);
	assert.deepEqual(notices, ["pi-copy: clipboard bridge command failed with status 127"]);
});

test("can suppress bridge failure notifications", async () => {
	const notices: string[] = [];
	const editor: PasteImageEditor = {};

	installPasteImageBridge(editor, {
		readPath: () => ({ ok: false, reason: "empty" }),
		pasteToEditor: () => undefined,
		notify: (message: string) => notices.push(message),
		notifyOnFailure: false,
	});

	await editor.onPasteImage?.();

	assert.deepEqual(notices, []);
});
