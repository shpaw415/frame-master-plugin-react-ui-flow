// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import * as parser from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import * as vscode from "vscode";

const traverse =
	"default" in traverseModule ? traverseModule.default : traverseModule;

type SelectionPoint = {
	line: number;
	column: number;
};

type SelectionLocation = {
	start: SelectionPoint;
	end: SelectionPoint;
};

type FileDocumentTarget = {
	scheme: "file";
	filePath: string;
};

type RemoteDocumentTarget = {
	scheme: "vscode-remote";
	authority: string;
	path: string;
};

type DocumentTarget = FileDocumentTarget | RemoteDocumentTarget;

type LocatorRequest = {
	fullPath: string;
	env: string;
	distro: string;
	startLine: number;
	startColumnOneBased: number;
	startColumnZero: number;
	documentTarget: DocumentTarget;
};

function normalizePosixPath(filePath: string) {
	return filePath.replace(/\\/g, "/");
}

function getDocumentTarget(
	filePath: string,
	env: string,
	distro: string,
): DocumentTarget {
	if (env === "wsl") {
		return {
			scheme: "vscode-remote",
			authority: `wsl+${distro || "Ubuntu"}`,
			path: normalizePosixPath(filePath),
		};
	}

	return {
		scheme: "file",
		filePath,
	};
}

function toDocumentUri(filePath: string, env: string, distro: string) {
	const target = getDocumentTarget(filePath, env, distro);

	if (target.scheme === "vscode-remote") {
		return vscode.Uri.from(target);
	}

	return vscode.Uri.file(target.filePath);
}

function parseInteger(value: string | null, fallback: number) {
	const parsed = Number.parseInt(value || "", 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function getQueryValue(params: URLSearchParams, key: string) {
	const value = params.get(key);
	return value === null ? "" : value;
}

function parseLocatorRequest(uri: vscode.Uri): LocatorRequest {
	const params = new URLSearchParams(uri.query);
	const projectPath = getQueryValue(params, "projectPath");
	const filePath = getQueryValue(params, "filePath");
	const env = getQueryValue(params, "env");
	const distro = getQueryValue(params, "distro");
	const fullPath =
		projectPath && filePath ? `${projectPath}${filePath}` : filePath;

	if (!fullPath) {
		throw new Error("Missing file path in Locator URI.");
	}

	const startLine = parseInteger(params.get("line"), 1);
	const startColumnOneBased = parseInteger(params.get("column"), 1);
	const startColumnZero = Math.max(startColumnOneBased - 1, 0);

	return {
		fullPath,
		env,
		distro,
		startLine,
		startColumnOneBased,
		startColumnZero,
		documentTarget: getDocumentTarget(fullPath, env, distro),
	};
}

function getSelectionRange(
	sourceText: string,
	startLine: number,
	startColumnZero: number,
): SelectionLocation {
	try {
		const ast = parser.parse(sourceText, {
			sourceType: "unambiguous",
			plugins: [
				"jsx",
				"typescript",
				"classProperties",
				"decorators-legacy",
				"importAttributes",
			],
			errorRecovery: true,
		});

		let matchedLocation: SelectionLocation | null = null;

		const matchesStart = (location: SelectionPoint | null | undefined) =>
			location &&
			location.line === startLine &&
			location.column === startColumnZero;

		traverse(ast, {
			JSXElement(path) {
				if (matchesStart(path.node.openingElement.loc?.start)) {
					matchedLocation =
						path.node.loc || path.node.openingElement.loc || null;
					path.stop();
				}
			},
			JSXFragment(path) {
				if (matchesStart(path.node.openingFragment.loc?.start)) {
					matchedLocation =
						path.node.loc || path.node.openingFragment.loc || null;
					path.stop();
				}
			},
		});

		if (matchedLocation) {
			return matchedLocation;
		}
	} catch {
		// Fall back to a point selection if the file cannot be parsed.
	}

	return {
		start: {
			line: startLine,
			column: startColumnZero,
		},
		end: {
			line: startLine,
			column: startColumnZero + 1,
		},
	};
}

function toEditorRange(location: SelectionLocation) {
	return new vscode.Range(
		new vscode.Position(
			Math.max((location.start.line || 1) - 1, 0),
			Math.max(location.start.column || 0, 0),
		),
		new vscode.Position(
			Math.max((location.end.line || location.start.line || 1) - 1, 0),
			Math.max(location.end.column || location.start.column || 0, 0),
		),
	);
}

async function openLocatorRange(uri: vscode.Uri) {
	const request = parseLocatorRequest(uri);
	const documentUri = toDocumentUri(
		request.fullPath,
		request.env,
		request.distro,
	);
	const document = await vscode.workspace.openTextDocument(documentUri);
	const location = getSelectionRange(
		document.getText(),
		request.startLine,
		request.startColumnZero,
	);
	const selection = toEditorRange(location);
	const editor = await vscode.window.showTextDocument(document, {
		preview: false,
		selection,
	});
	editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

export const __testHooks = {
	normalizePosixPath,
	getDocumentTarget,
	parseLocatorRequest,
	getSelectionRange,
	toEditorRange,
};

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri(uri: vscode.Uri) {
				if (uri.path !== "/open") {
					return;
				}

				return openLocatorRange(uri).catch((error) => {
					const message =
						error instanceof Error ? error.message : "Unknown Locator error.";
					void vscode.window.showErrorMessage(`LocatorJS: ${message}`);
				});
			},
		}),
	);
}

export function deactivate() {}
