import * as assert from "assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import type * as SourceExtensionModule from "../extension";

const { __testHooks } =
	require("../../dist/extension.js") as typeof SourceExtensionModule;

const EXTENSION_ID =
	"m2tech-solutions.frame-master-react-ui-flow-locator-range-handler";

function createLocatorUri(values: Record<string, string>) {
	return vscode.Uri.from({
		scheme: "vscode",
		authority:
			"m2tech-solutions.frame-master-react-ui-flow-locator-range-handler",
		path: values.previewUrl ? "/webview" : "/open",
		query: new URLSearchParams(values).toString(),
	});
}

function createPreviewUri(values: Record<string, string>) {
	return vscode.Uri.from({
		scheme: "vscode",
		authority:
			"m2tech-solutions.frame-master-react-ui-flow-locator-range-handler",
		path: "/preview",
		query: new URLSearchParams(values).toString(),
	});
}

async function waitForCondition(
	condition: () => boolean,
	timeoutMs: number,
	message: string,
) {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (condition()) {
			return;
		}

		await new Promise<void>((resolve) => {
			globalThis.setTimeout(resolve, 50);
		});
	}

	throw new Error(message);
}

suite("Locator Range Handler", () => {
	test("parses Linux locator requests", () => {
		const request = __testHooks.parseLocatorRequest(
			createLocatorUri({
				projectPath: "/workspace/certorify",
				filePath: "/src/App.tsx",
				line: "12",
				column: "4",
				env: "linux",
			}),
		);

		assert.strictEqual(request.fullPath, "/workspace/certorify/src/App.tsx");
		assert.strictEqual(request.startLine, 12);
		assert.strictEqual(request.startColumnOneBased, 4);
		assert.strictEqual(request.startColumnZero, 3);
		assert.deepStrictEqual(request.documentTarget, {
			scheme: "file",
			filePath: "/workspace/certorify/src/App.tsx",
		});
	});

	test("parses Windows locator requests", () => {
		const request = __testHooks.parseLocatorRequest(
			createLocatorUri({
				projectPath: "C:\\repo",
				filePath: "\\src\\App.tsx",
				line: "8",
				column: "2",
				env: "windows",
			}),
		);

		assert.strictEqual(request.fullPath, "C:\\repo\\src\\App.tsx");
		assert.strictEqual(request.startLine, 8);
		assert.strictEqual(request.startColumnOneBased, 2);
		assert.strictEqual(request.startColumnZero, 1);
		assert.deepStrictEqual(request.documentTarget, {
			scheme: "file",
			filePath: "C:\\repo\\src\\App.tsx",
		});
	});

	test("parses WSL locator requests into remote targets", () => {
		const request = __testHooks.parseLocatorRequest(
			createLocatorUri({
				projectPath: "/home/shpaw415/project",
				filePath: "/src/App.tsx",
				line: "5",
				column: "7",
				env: "wsl",
				distro: "Ubuntu-24.04",
			}),
		);

		assert.strictEqual(request.fullPath, "/home/shpaw415/project/src/App.tsx");
		assert.strictEqual(request.startLine, 5);
		assert.strictEqual(request.startColumnOneBased, 7);
		assert.strictEqual(request.startColumnZero, 6);
		assert.deepStrictEqual(request.documentTarget, {
			scheme: "vscode-remote",
			authority: "wsl+Ubuntu-24.04",
			path: "/home/shpaw415/project/src/App.tsx",
		});
	});

	test("defaults WSL distro and normalizes backslashes", () => {
		assert.deepStrictEqual(
			__testHooks.getDocumentTarget("C:\\repo\\src\\App.tsx", "wsl", ""),
			{
				scheme: "vscode-remote",
				authority: "wsl+Ubuntu",
				path: "C:/repo/src/App.tsx",
			},
		);
	});

	test("selects the whole JSX element from the locator position", () => {
		const sourceText = [
			"export function Demo() {",
			"\treturn (",
			"\t\t<section>",
			"\t\t\t<button>Save</button>",
			"\t\t</section>",
			"\t);",
			"}",
		].join("\n");

		const selection = __testHooks.getSelectionRange(sourceText, 4, 3);

		assert.strictEqual(selection.start.line, 4);
		assert.strictEqual(selection.start.column, 3);
		assert.strictEqual(selection.end.line, 4);
		assert.strictEqual(selection.end.column, 24);
	});

	test("accepts webview messages with locator requests", () => {
		const request = __testHooks.parseLocatorRequest(
			createLocatorUri({
				projectPath: "/workspace/certorify",
				filePath: "/src/App.tsx",
				line: "10",
				column: "6",
				env: "linux",
			}),
		);

		assert.strictEqual(
			__testHooks.isLocatorWebviewMessage({
				type: "open-locator",
				request,
			}),
			true,
		);
	});

	test("parses webview panel state with preview url", () => {
		const state = __testHooks.parseLocatorPanelState(
			createLocatorUri({
				projectPath: "/workspace/certorify",
				filePath: "/src/App.tsx",
				line: "14",
				column: "9",
				env: "linux",
				previewUrl: "http://127.0.0.1:3000/app",
				previewTitle: "Certorify Preview",
			}),
		);

		assert.strictEqual(state.previewTitle, "Certorify Preview");
		assert.strictEqual(state.previewOrigin, "http://127.0.0.1:3000");
		assert.match(
			state.previewSourceUrl,
			/http:\/\/127\.0\.0\.1:3000\/app\?frameMasterPreview=vscode/,
		);
		assert.strictEqual(
			state.request?.fullPath,
			"/workspace/certorify/src/App.tsx",
		);
	});

	test("creates startup preview panel state without a current source", () => {
		const state = __testHooks.createLocatorPanelState(
			"http://127.0.0.1:3000/app",
			"Startup Preview",
		);

		assert.strictEqual(state.request, undefined);
		assert.strictEqual(state.previewTitle, "Startup Preview");
		assert.strictEqual(state.previewOrigin, "http://127.0.0.1:3000");
		assert.match(
			state.previewSourceUrl,
			/http:\/\/127\.0\.0\.1:3000\/app\?frameMasterPreview=vscode/,
		);
	});

	test("parses preview route without requiring a file target", () => {
		const state = __testHooks.parsePreviewPanelState(
			createPreviewUri({
				previewUrl: "http://127.0.0.1:3000/app",
				previewTitle: "CLI Preview",
			}),
		);

		assert.strictEqual(state.request, undefined);
		assert.strictEqual(state.previewTitle, "CLI Preview");
		assert.strictEqual(state.previewOrigin, "http://127.0.0.1:3000");
		assert.match(
			state.previewSourceUrl,
			/http:\/\/127\.0\.0\.1:3000\/app\?frameMasterPreview=vscode/,
		);
	});

	test("detects preview marker documents", () => {
		const document = {
			uri: {
				scheme: "file",
				fsPath:
					"/workspace/certorify/.frame-master/frame-master-react-ui-flow.preview.json",
			},
		} as vscode.TextDocument;

		assert.strictEqual(__testHooks.isPreviewMarkerDocument(document), true);
	});

	test("parses preview marker payload", () => {
		const state = __testHooks.parsePreviewMarkerPayload(
			JSON.stringify({
				type: "frame-master-react-ui-flow.preview",
				previewUrl: "http://127.0.0.1:3000/app",
				previewTitle: "CLI Marker Preview",
			}),
		);

		assert.strictEqual(state?.request, undefined);
		assert.strictEqual(state?.previewTitle, "CLI Marker Preview");
		assert.strictEqual(state?.previewOrigin, "http://127.0.0.1:3000");
	});

	test("opens the webview when a preview marker document is handled", async () => {
		const documentUri = vscode.Uri.file(
			"/workspace/certorify/.frame-master/frame-master-react-ui-flow.preview.json",
		);
		const document = {
			uri: documentUri,
			getText: () =>
				JSON.stringify({
					type: "frame-master-react-ui-flow.preview",
					previewUrl: "http://127.0.0.1:3000/app",
					previewTitle: "Marker Trigger Preview",
				}),
		} as vscode.TextDocument;

		const shownStates: Array<
			ReturnType<typeof __testHooks.createLocatorPanelState>
		> = [];
		const closedUris: vscode.Uri[] = [];

		const didOpen = await __testHooks.maybeOpenPreviewMarkerDocumentWithActions(
			{} as vscode.ExtensionContext,
			document,
			{
				showPanel: async (_context, state) => {
					shownStates.push(state);
				},
				closeTab: async (uri) => {
					closedUris.push(uri);
				},
			},
		);

		assert.strictEqual(didOpen, true);
		assert.strictEqual(shownStates.length, 1);
		assert.strictEqual(shownStates[0]?.previewTitle, "Marker Trigger Preview");
		assert.strictEqual(shownStates[0]?.previewUrl, "http://127.0.0.1:3000/app");
		assert.strictEqual(closedUris.length, 1);
		assert.strictEqual(closedUris[0]?.toString(), documentUri.toString());
	});

	test("opening the preview marker file creates the preview webview tab", async function () {
		this.timeout(10000);

		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, "Extension should be available in the test host.");
		await extension?.activate();

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(
			workspaceFolder,
			"A workspace folder is required for integration tests.",
		);

		if (!workspaceFolder) {
			throw new Error("A workspace folder is required for integration tests.");
		}

		const testRootUri = vscode.Uri.joinPath(
			workspaceFolder.uri,
			".vscode-test-preview",
			`${Date.now()}`,
		);

		const markerDirectoryUri = vscode.Uri.joinPath(
			testRootUri,
			".frame-master",
		);
		const markerUri = vscode.Uri.joinPath(
			markerDirectoryUri,
			"frame-master-react-ui-flow.preview.json",
		);

		await vscode.workspace.fs.createDirectory(markerDirectoryUri);
		await vscode.workspace.fs.writeFile(
			markerUri,
			new TextEncoder().encode(
				JSON.stringify(
					{
						type: "frame-master-react-ui-flow.preview",
						previewUrl: "http://127.0.0.1:3000/app",
						previewTitle: "Integration Marker Preview",
					},
					null,
					2,
				),
			),
		);

		__testHooks.resetPreviewDiagnostics();
		__testHooks.disposeLocatorWebviewPanel();

		try {
			const document = await vscode.workspace.openTextDocument(markerUri);

			try {
				await vscode.window.showTextDocument(document, {
					preview: false,
					preserveFocus: false,
				});
			} catch {
				// The marker tab may be closed immediately when the extension swaps it for the preview webview.
			}

			await waitForCondition(
				() => __testHooks.getPreviewMarkerDocumentAttemptCount() > 0,
				5000,
				"Expected the preview marker open listeners to observe the opened document.",
			);

			await waitForCondition(
				() => __testHooks.getPreviewMarkerDocumentHandleCount() > 0,
				5000,
				`Expected the preview marker document handler to run after opening the marker file. Last observed document URI: ${__testHooks.getLastPreviewMarkerDocumentUri()}`,
			);

			assert.ok(
				__testHooks.getLocatorWebviewPanelOpenCount() > 0,
				"Expected the preview webview opening path to run after handling the marker document.",
			);

			await waitForCondition(
				() => __testHooks.isLocatorWebviewPanelOpen(),
				5000,
				"Expected the preview webview panel to open after showing the marker document.",
			);

			assert.strictEqual(__testHooks.isLocatorWebviewPanelOpen(), true);
			assert.match(
				__testHooks.getLocatorWebviewPanelTitle() || "",
				/Integration Marker Preview|Frame Master UI Flow/,
			);
		} finally {
			__testHooks.disposeLocatorWebviewPanel();

			await vscode.workspace.fs.delete(testRootUri, {
				recursive: true,
				useTrash: false,
			});
		}
	});

	test("extracts auto-open preview config from frame master source", () => {
		const configs = __testHooks.parseAutoOpenPreviewConfigs(`
			const plugins = [
				UIFlowPlugin({
					env: "wsl",
					editor: "vscode",
					useWebview: true,
					webviewUrl: "http://localhost:3001",
					webviewTitle: "Certorify Preview",
				}),
			];
		`);

		assert.deepStrictEqual(configs, [
			{
				previewUrl: "http://localhost:3001",
				previewTitle: "Certorify Preview",
				configPath: "",
			},
		]);
	});

	test("extracts auto-open preview config for cursor", () => {
		const configs = __testHooks.parseAutoOpenPreviewConfigs(`
			const plugins = [
				UIFlowPlugin({
					env: "windows",
					editor: "cursor",
					useWebview: true,
					webviewUrl: "http://localhost:3010",
					webviewTitle: "Cursor Preview",
				}),
			];
		`);

		assert.deepStrictEqual(configs, [
			{
				previewUrl: "http://localhost:3010",
				previewTitle: "Cursor Preview",
				configPath: "",
			},
		]);
	});

	test("treats reachable preview responses as auto-open candidates", () => {
		assert.strictEqual(__testHooks.shouldAutoOpenForPreviewResponse(200), true);
		assert.strictEqual(__testHooks.shouldAutoOpenForPreviewResponse(404), true);
		assert.strictEqual(
			__testHooks.shouldAutoOpenForPreviewResponse(503),
			false,
		);
	});

	test("accepts locator uri relay messages", () => {
		assert.strictEqual(
			__testHooks.isLocatorUriMessage({
				type: "open-locator-uri",
				href: "vscode://m2tech-solutions.frame-master-react-ui-flow-locator-range-handler/webview?projectPath=/workspace&filePath=/src/App.tsx&line=1&column=1&env=linux",
			}),
			true,
		);
	});

	test("accepts webview control messages", () => {
		assert.strictEqual(
			__testHooks.isLocatorWebviewControlMessage({ type: "navigate-back" }),
			true,
		);
		assert.strictEqual(
			__testHooks.isLocatorWebviewControlMessage({ type: "navigate-forward" }),
			true,
		);
		assert.strictEqual(
			__testHooks.isLocatorWebviewControlMessage({ type: "reload-preview" }),
			true,
		);
	});

	test("renders webview html with source action", () => {
		const state = __testHooks.parseLocatorPanelState(
			createLocatorUri({
				projectPath: "/workspace/certorify",
				filePath: "/src/App.tsx",
				line: "14",
				column: "9",
				env: "linux",
				previewUrl: "http://127.0.0.1:3000/app",
			}),
		);

		const html = __testHooks.getWebviewHtml(state);

		assert.match(html, /acquireVsCodeApi\(\)/);
		assert.match(html, /type:\s*"open-locator-uri"/);
		assert.match(html, /navigate-back/);
		assert.match(html, /navigate-forward/);
		assert.match(html, /reload-preview/);
		assert.match(html, /id="location-form"/);
		assert.match(html, /id="location-input"/);
		assert.match(html, /value="http:\/\/127\.0\.0\.1:3000\/app"/);
		assert.match(html, /frame-master-preview-location/);
		assert.match(
			html,
			/contentWindow\?\.postMessage\(\{ type: navigateBackType \}/,
		);
		assert.match(
			html,
			/contentWindow\?\.postMessage\(\{ type: navigateForwardType \}/,
		);
		assert.match(html, /iframe id="preview-frame"/);
		assert.match(
			html,
			/data-src="http:\/\/127\.0\.0\.1:3000\/app\?frameMasterPreview=vscode"/,
		);
		assert.match(html, /src="about:blank"/);
		assert.doesNotMatch(html, /Open Current Source/);
		assert.doesNotMatch(html, /Reload Preview/);
		assert.doesNotMatch(html, /Frame Master Preview/);
		assert.match(html, /frameMasterPreview=vscode/);
		assert.match(
			html,
			/data-source-path="\/workspace\/certorify\/src\/App\.tsx"/,
		);
		assert.match(html, /\/workspace\/certorify\/src\/App\.tsx/);
	});

	test("renders startup webview html without source action", () => {
		const html = __testHooks.getWebviewHtml(
			__testHooks.createLocatorPanelState(
				"http://127.0.0.1:3000/app",
				"Startup Preview",
				undefined,
				"/workspace/certorify/frame-master.config.ts",
			),
		);

		assert.match(html, /iframe id="preview-frame"/);
		assert.match(
			html,
			/data-config-path="\/workspace\/certorify\/frame-master\.config\.ts"/,
		);
		assert.doesNotMatch(html, /Open Current Source/);
		assert.doesNotMatch(html, /Awaiting LocatorJS selection/);
	});
});
