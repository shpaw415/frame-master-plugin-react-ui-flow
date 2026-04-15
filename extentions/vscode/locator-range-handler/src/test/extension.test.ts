import * as assert from "assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { __testHooks } from "../extension";

function createLocatorUri(values: Record<string, string>) {
	return vscode.Uri.from({
		scheme: "vscode",
		authority:
			"m2tech-solutions.frame-master-react-ui-flow-locator-range-handler",
		path: "/open",
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
});
