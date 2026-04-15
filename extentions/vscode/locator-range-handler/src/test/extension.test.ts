import * as assert from "assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { __testHooks } from "../extension";

function createLocatorUri(values: Record<string, string>) {
	return vscode.Uri.from({
		scheme: "vscode",
		authority:
			"m2tech-solutions.frame-master-react-ui-flow-locator-range-handler",
		path: values.previewUrl ? "/webview" : "/open",
		query: new URLSearchParams(values).toString(),
	});
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

		assert.match(html, /Open Current Source/);
		assert.match(html, /Reload Preview/);
		assert.match(html, /acquireVsCodeApi\(\)/);
		assert.match(html, /type:\s*"open-locator"/);
		assert.match(html, /type:\s*"open-locator-uri"/);
		assert.match(html, /iframe id="preview-frame"/);
		assert.match(html, /frameMasterPreview=vscode/);
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

		assert.match(html, /No source selected yet|frame-master\.config\.ts/);
		assert.match(html, /Awaiting LocatorJS selection/);
		assert.match(html, /disabled aria-disabled="true"/);
	});
});
