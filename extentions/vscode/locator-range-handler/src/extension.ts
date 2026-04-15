// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import * as parser from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import { isExpression } from "@babel/types";
import type { Expression, ObjectExpression } from "@babel/types";
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

type LocatorWebviewMessage = {
	type: "open-locator";
	request: LocatorRequest;
};

type LocatorUriMessage = {
	type: "open-locator-uri";
	href: string;
};

type LocatorPanelState = {
	request?: LocatorRequest;
	previewUrl: string;
	previewTitle: string;
	previewOrigin: string;
	previewSourceUrl: string;
	configPath?: string;
};

type AutoOpenPreviewConfig = {
	previewUrl: string;
	previewTitle: string;
	configPath: string;
};

const WEBVIEW_PANEL_VIEW_TYPE =
	"frameMasterReactUiFlowLocatorRangeHandler.preview";
const WEBVIEW_PANEL_TITLE = "Frame Master UI Flow";
const PREVIEW_URL_QUERY_KEY = "previewUrl";
const PREVIEW_TITLE_QUERY_KEY = "previewTitle";
const PREVIEW_MODE_QUERY_KEY = "frameMasterPreview";
const PREVIEW_MODE_QUERY_VALUE = "vscode";
const PREVIEW_BRIDGE_MESSAGE_TYPE = "frame-master-open-locator-uri";
const PREVIEW_AUTO_OPEN_POLL_INTERVAL_MS = 1000;
const PREVIEW_AUTO_OPEN_TIMEOUT_MS = 5 * 60 * 1000;
const PREVIEW_REACHABILITY_TIMEOUT_MS = 1500;
const FRAME_MASTER_CONFIG_FILE_NAMES = [
	"frame-master.config.ts",
	"frame-master.config.mts",
	"frame-master.config.js",
	"frame-master.config.mjs",
];

let locatorWebviewPanel: vscode.WebviewPanel | undefined;
let didHandleLocatorUri = false;

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

function appendQueryValue(url: string, key: string, value: string) {
	const parsedUrl = new URL(url);
	parsedUrl.searchParams.set(key, value);
	return parsedUrl.toString();
}

function createLocatorPanelState(
	previewUrl: string,
	previewTitle: string,
	request?: LocatorRequest,
	configPath?: string,
): LocatorPanelState {
	if (!previewUrl) {
		return {
			request,
			previewUrl: "",
			previewTitle: previewTitle || WEBVIEW_PANEL_TITLE,
			previewOrigin: "",
			previewSourceUrl: "",
			configPath,
		};
	}

	const previewSourceUrl = appendQueryValue(
		previewUrl,
		PREVIEW_MODE_QUERY_KEY,
		PREVIEW_MODE_QUERY_VALUE,
	);

	return {
		request,
		previewUrl,
		previewTitle: previewTitle || WEBVIEW_PANEL_TITLE,
		previewOrigin: new URL(previewSourceUrl).origin,
		previewSourceUrl,
		configPath,
	};
}

function parseLocatorPanelState(uri: vscode.Uri): LocatorPanelState {
	const params = new URLSearchParams(uri.query);
	const previewUrl = getQueryValue(params, PREVIEW_URL_QUERY_KEY);
	const previewTitle = getQueryValue(params, PREVIEW_TITLE_QUERY_KEY);
	const request = parseLocatorRequest(uri);

	return createLocatorPanelState(previewUrl, previewTitle, request);
}

function unwrapExpression(expression: Expression): Expression {
	if (expression.type === "TSAsExpression") {
		return unwrapExpression(expression.expression);
	}

	if (expression.type === "TSSatisfiesExpression") {
		return unwrapExpression(expression.expression);
	}

	if (expression.type === "TypeCastExpression") {
		return unwrapExpression(expression.expression);
	}

	if (expression.type === "ParenthesizedExpression") {
		return unwrapExpression(expression.expression);
	}

	return expression;
}

function getObjectPropertyExpression(
	objectExpression: ObjectExpression,
	propertyName: string,
) {
	for (const property of objectExpression.properties) {
		if (property.type !== "ObjectProperty" || property.computed) {
			continue;
		}

		const keyName =
			property.key.type === "Identifier"
				? property.key.name
				: property.key.type === "StringLiteral"
					? property.key.value
					: undefined;

		if (keyName !== propertyName || !isExpression(property.value)) {
			continue;
		}

		return unwrapExpression(property.value);
	}

	return undefined;
}

function getStaticStringValue(expression: Expression | undefined) {
	if (!expression) {
		return undefined;
	}

	if (expression.type === "StringLiteral") {
		return expression.value;
	}

	if (
		expression.type === "TemplateLiteral" &&
		expression.expressions.length === 0
	) {
		return expression.quasis.map((quasi) => quasi.value.cooked || "").join("");
	}

	return undefined;
}

function getStaticBooleanValue(expression: Expression | undefined) {
	if (!expression) {
		return undefined;
	}

	return expression.type === "BooleanLiteral" ? expression.value : undefined;
}

function parseAutoOpenPreviewConfigs(
	sourceText: string,
): AutoOpenPreviewConfig[] {
	try {
		const ast = parser.parse(sourceText, {
			sourceType: "module",
			plugins: [
				"jsx",
				"typescript",
				"classProperties",
				"decorators-legacy",
				"importAttributes",
			],
			errorRecovery: true,
		});

		const configs: AutoOpenPreviewConfig[] = [];

		traverse(ast, {
			CallExpression(path) {
				if (
					path.node.callee.type !== "Identifier" ||
					path.node.callee.name !== "UIFlowPlugin"
				) {
					return;
				}

				const [configArgument] = path.node.arguments;

				if (!configArgument || configArgument.type !== "ObjectExpression") {
					return;
				}

				const editor = getStaticStringValue(
					getObjectPropertyExpression(configArgument, "editor"),
				);
				const useWebview = getStaticBooleanValue(
					getObjectPropertyExpression(configArgument, "useWebview"),
				);
				const previewUrl = getStaticStringValue(
					getObjectPropertyExpression(configArgument, "webviewUrl"),
				);
				const previewTitle =
					getStaticStringValue(
						getObjectPropertyExpression(configArgument, "webviewTitle"),
					) || WEBVIEW_PANEL_TITLE;

				if (editor !== "vscode" || useWebview !== true || !previewUrl) {
					return;
				}

				configs.push({
					previewUrl,
					previewTitle,
					configPath: "",
				});
			},
		});

		return configs;
	} catch {
		return [];
	}
}

async function readTextFile(uri: vscode.Uri) {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder().decode(bytes);
}

function shouldAutoOpenForPreviewResponse(status: number) {
	return status >= 200 && status < 500;
}

async function isPreviewUrlReachable(url: string) {
	const abortController = new AbortController();
	const timeoutHandle = globalThis.setTimeout(() => {
		abortController.abort();
	}, PREVIEW_REACHABILITY_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: "GET",
			redirect: "follow",
			signal: abortController.signal,
		});
		return shouldAutoOpenForPreviewResponse(response.status);
	} catch {
		return false;
	} finally {
		globalThis.clearTimeout(timeoutHandle);
	}
}

async function findAutoOpenPreviewConfig() {
	for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
		for (const fileName of FRAME_MASTER_CONFIG_FILE_NAMES) {
			const configUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);

			try {
				const sourceText = await readTextFile(configUri);
				const [config] = parseAutoOpenPreviewConfigs(sourceText);

				if (!config) {
					continue;
				}

				return {
					...config,
					configPath: configUri.fsPath,
				};
			} catch {
				continue;
			}
		}
	}

	return undefined;
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

function isDocumentTarget(value: unknown): value is DocumentTarget {
	if (!value || typeof value !== "object") {
		return false;
	}

	if ((value as DocumentTarget).scheme === "file") {
		return typeof (value as FileDocumentTarget).filePath === "string";
	}

	if ((value as DocumentTarget).scheme === "vscode-remote") {
		return (
			typeof (value as RemoteDocumentTarget).authority === "string" &&
			typeof (value as RemoteDocumentTarget).path === "string"
		);
	}

	return false;
}

function isLocatorRequest(value: unknown): value is LocatorRequest {
	if (!value || typeof value !== "object") {
		return false;
	}

	const request = value as LocatorRequest;
	return (
		typeof request.fullPath === "string" &&
		typeof request.env === "string" &&
		typeof request.distro === "string" &&
		typeof request.startLine === "number" &&
		typeof request.startColumnOneBased === "number" &&
		typeof request.startColumnZero === "number" &&
		isDocumentTarget(request.documentTarget)
	);
}

function isLocatorWebviewMessage(
	value: unknown,
): value is LocatorWebviewMessage {
	return (
		!!value &&
		typeof value === "object" &&
		(value as LocatorWebviewMessage).type === "open-locator" &&
		isLocatorRequest((value as LocatorWebviewMessage).request)
	);
}

function isLocatorUriMessage(value: unknown): value is LocatorUriMessage {
	return (
		!!value &&
		typeof value === "object" &&
		(value as LocatorUriMessage).type === "open-locator-uri" &&
		typeof (value as LocatorUriMessage).href === "string"
	);
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;");
}

async function openLocatorRequest(request: LocatorRequest) {
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

function getWebviewHtml(state: LocatorPanelState) {
	const requestJson = JSON.stringify(state.request ?? null)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e");
	const previewTitle = escapeHtml(state.previewTitle || WEBVIEW_PANEL_TITLE);
	const pathLabel = escapeHtml(
		state.request?.fullPath || state.configPath || "No source selected yet",
	);
	const envLabel = escapeHtml(state.request?.env || "preview");
	const locationLabel = state.request
		? `${state.request.startLine}:${state.request.startColumnOneBased}`
		: "Awaiting LocatorJS selection";
	const previewSourceUrl = state.previewSourceUrl
		? escapeHtml(state.previewSourceUrl)
		: "";
	const previewOriginJson = JSON.stringify(state.previewOrigin)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e");
	const bridgeMessageTypeJson = JSON.stringify(PREVIEW_BRIDGE_MESSAGE_TYPE);
	const sourceButtonAttributes = state.request
		? ""
		: ' disabled aria-disabled="true"';
	const introCopy = state.request
		? "The preview runs inside VS Code. LocatorJS clicks from the embedded app are bridged back into the extension so source navigation stays inside the editor."
		: "The preview is live inside VS Code. Use LocatorJS inside the iframe and choose the VS Code target to sync the current source location into this panel.";
	const iframeMarkup = state.previewSourceUrl
		? `<iframe id="preview-frame" src="${previewSourceUrl}" title="${previewTitle}"></iframe>`
		: `<section class="empty-state"><p>No preview URL was configured for this webview target.</p><p>Add <code>webviewUrl</code> to the plugin config to load your local app inside VS Code.</p></section>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${previewTitle}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https: http:; frame-src https: http:; connect-src https: http:;">
<style>
	:root {
		color-scheme: light dark;
		font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
		--panel: color-mix(in srgb, var(--vscode-editor-background) 82%, #c97f35 18%);
		--panel-border: color-mix(in srgb, var(--vscode-panel-border) 60%, #d38b2d 40%);
		--accent: #d38b2d;
		--ink: var(--vscode-editor-foreground);
		--muted: color-mix(in srgb, var(--vscode-descriptionForeground) 72%, var(--vscode-editor-foreground) 28%);
	}
	body {
		margin: 0;
		min-height: 100vh;
		color: var(--ink);
		background:
			radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-editor-background) 62%, #d38b2d 38%), transparent 28%),
			linear-gradient(135deg, color-mix(in srgb, var(--vscode-editor-background) 94%, #22160c 6%), var(--vscode-editor-background));
	}
	main {
		min-height: 100vh;
		display: grid;
		grid-template-rows: auto 1fr;
	}
	.shell {
		display: grid;
		grid-template-columns: minmax(280px, 360px) 1fr;
		gap: 18px;
		padding: 18px;
	}
	.sidebar,
	.stage {
		border: 1px solid var(--panel-border);
		background: color-mix(in srgb, var(--panel) 90%, transparent 10%);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
		backdrop-filter: blur(18px);
	}
	.sidebar {
		border-radius: 22px;
		padding: 22px;
		display: grid;
		align-content: start;
		gap: 18px;
	}
	.stage {
		border-radius: 28px;
		overflow: hidden;
		display: grid;
		grid-template-rows: auto 1fr;
	}
	.stage-frame {
		min-height: 0;
		background: color-mix(in srgb, var(--vscode-editor-background) 88%, #140e08 12%);
	}
	h1 {
		margin: 0;
		font-size: clamp(1.6rem, 2vw, 2.1rem);
		line-height: 1.05;
		letter-spacing: -0.03em;
	}
	.header-copy {
		display: grid;
		gap: 10px;
	}
	.kicker {
		font-family: "Courier New", monospace;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: var(--accent);
	}
	.card {
		border: 1px solid color-mix(in srgb, var(--panel-border) 72%, transparent 28%);
		border-radius: 16px;
		padding: 16px;
		background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 94%, white 6%), color-mix(in srgb, var(--panel) 86%, transparent 14%));
	}
	dl {
		display: grid;
		grid-template-columns: 92px 1fr;
		gap: 8px 12px;
		margin: 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
		word-break: break-word;
		color: var(--muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	button {
		width: fit-content;
		padding: 11px 16px;
		border: 1px solid transparent;
		border-radius: 999px;
		cursor: pointer;
		font: inherit;
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
	}
	button:hover {
		background: var(--vscode-button-hoverBackground);
		transform: translateY(-1px);
	}
	button.secondary {
		color: var(--ink);
		background: transparent;
		border-color: color-mix(in srgb, var(--panel-border) 68%, transparent 32%);
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
	}
	p {
		margin: 0;
		line-height: 1.5;
		color: var(--muted);
	}
	code {
		font-family: "Courier New", monospace;
		font-size: 0.92em;
	}
	.stage-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 74%, transparent 26%);
		background: linear-gradient(90deg, color-mix(in srgb, var(--panel) 82%, #1a1109 18%), color-mix(in srgb, var(--panel) 94%, transparent 6%));
	}
	.stage-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.pill {
		padding: 6px 10px;
		border-radius: 999px;
		font-family: "Courier New", monospace;
		font-size: 0.78rem;
		color: var(--ink);
		background: color-mix(in srgb, var(--vscode-editor-background) 74%, var(--accent) 26%);
	}
	iframe {
		width: 100%;
		height: 100%;
		border: 0;
		background: white;
	}
	.empty-state {
		height: 100%;
		display: grid;
		place-content: center;
		gap: 10px;
		padding: 32px;
		text-align: center;
	}
	@media (max-width: 960px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.stage {
			min-height: 60vh;
		}
	}
</style>
</head>
<body>
<main>
	<section class="shell">
		<aside class="sidebar">
			<div class="header-copy">
				<div class="kicker">Frame Master Preview</div>
				<h1>${previewTitle}</h1>
				<p>${introCopy}</p>
			</div>
			<section class="card">
				<dl>
					<dt>File</dt>
					<dd><code>${pathLabel}</code></dd>
					<dt>Location</dt>
					<dd><code>${locationLabel}</code></dd>
					<dt>Environment</dt>
					<dd><code>${envLabel}</code></dd>
				</dl>
			</section>
			<div class="actions">
				<button id="open-source" type="button"${sourceButtonAttributes}>Open Current Source</button>
				<button class="secondary" id="reload-preview" type="button">Reload Preview</button>
			</div>
		</aside>
		<section class="stage">
			<div class="stage-bar">
				<div class="stage-meta">
					<span class="pill">${envLabel}</span>
					<span class="pill">${escapeHtml(state.previewUrl || "No preview URL")}</span>
				</div>
				<span class="pill">Locator bridge live</span>
			</div>
			<div class="stage-frame">
				${iframeMarkup}
			</div>
		</section>
	</section>
</main>
<script>
	const vscode = acquireVsCodeApi();
	const request = ${requestJson};
	const previewOrigin = ${previewOriginJson};
	const bridgeMessageType = ${bridgeMessageTypeJson};
	const previewFrame = document.getElementById("preview-frame");
	document.getElementById("open-source")?.addEventListener("click", () => {
		if (request) {
			vscode.postMessage({ type: "open-locator", request });
		}
	});
	document.getElementById("reload-preview")?.addEventListener("click", () => {
		if (previewFrame instanceof HTMLIFrameElement && previewFrame.src) {
			previewFrame.src = previewFrame.src;
		}
	});
	window.addEventListener("message", (event) => {
		if (previewOrigin && event.origin !== previewOrigin) {
			return;
		}

		const data = event.data;

		if (!data || typeof data !== "object") {
			return;
		}

		if (data.type !== bridgeMessageType || typeof data.href !== "string") {
			return;
		}

		vscode.postMessage({ type: "open-locator-uri", href: data.href });
	});
</script>
</body>
</html>`;
}

async function openLocatorRange(uri: vscode.Uri) {
	const request = parseLocatorRequest(uri);
	await openLocatorRequest(request);
}

function showLocatorWebviewPanel(
	context: vscode.ExtensionContext,
	state: LocatorPanelState,
) {
	if (!locatorWebviewPanel) {
		locatorWebviewPanel = vscode.window.createWebviewPanel(
			WEBVIEW_PANEL_VIEW_TYPE,
			WEBVIEW_PANEL_TITLE,
			vscode.ViewColumn.Beside,
			{ enableScripts: true, retainContextWhenHidden: true },
		);

		locatorWebviewPanel.onDidDispose(
			() => {
				locatorWebviewPanel = undefined;
			},
			null,
			context.subscriptions,
		);

		locatorWebviewPanel.webview.onDidReceiveMessage(
			(message: unknown) => {
				if (isLocatorWebviewMessage(message)) {
					void openLocatorRequest(message.request).catch((error) => {
						const messageText =
							error instanceof Error ? error.message : "Unknown Locator error.";
						void vscode.window.showErrorMessage(`LocatorJS: ${messageText}`);
					});
					return;
				}

				if (!isLocatorUriMessage(message)) {
					return;
				}

				void openLocatorRange(vscode.Uri.parse(message.href)).catch((error) => {
					const messageText =
						error instanceof Error ? error.message : "Unknown Locator error.";
					void vscode.window.showErrorMessage(`LocatorJS: ${messageText}`);
				});
			},
			null,
			context.subscriptions,
		);
	}

	locatorWebviewPanel.title = state.request
		? `${state.previewTitle}: ${state.request.startLine}:${state.request.startColumnOneBased}`
		: state.previewTitle;
	locatorWebviewPanel.webview.html = getWebviewHtml(state);
	locatorWebviewPanel.reveal(vscode.ViewColumn.Beside, true);
}

function openLocatorWebview(context: vscode.ExtensionContext, uri: vscode.Uri) {
	showLocatorWebviewPanel(context, parseLocatorPanelState(uri));
}

async function autoOpenConfiguredPreview(context: vscode.ExtensionContext) {
	const config = await findAutoOpenPreviewConfig();

	if (!config) {
		return;
	}

	let inFlight = false;
	const startedAt = Date.now();
	let disposed = false;

	const stopWatching = () => {
		disposed = true;
		globalThis.clearInterval(intervalHandle);
	};

	const tick = async () => {
		if (disposed || inFlight) {
			return;
		}

		if (didHandleLocatorUri || locatorWebviewPanel) {
			stopWatching();
			return;
		}

		if (Date.now() - startedAt > PREVIEW_AUTO_OPEN_TIMEOUT_MS) {
			stopWatching();
			return;
		}

		inFlight = true;

		try {
			const reachable = await isPreviewUrlReachable(config.previewUrl);

			if (!reachable) {
				return;
			}

			showLocatorWebviewPanel(
				context,
				createLocatorPanelState(
					config.previewUrl,
					config.previewTitle,
					undefined,
					config.configPath,
				),
			);
			stopWatching();
		} finally {
			inFlight = false;
		}
	};

	const intervalHandle = globalThis.setInterval(() => {
		void tick();
	}, PREVIEW_AUTO_OPEN_POLL_INTERVAL_MS);

	context.subscriptions.push({
		dispose: stopWatching,
	});

	void tick();
}

export const __testHooks = {
	normalizePosixPath,
	getDocumentTarget,
	parseLocatorRequest,
	parseLocatorPanelState,
	parseAutoOpenPreviewConfigs,
	createLocatorPanelState,
	findAutoOpenPreviewConfig,
	shouldAutoOpenForPreviewResponse,
	appendQueryValue,
	getSelectionRange,
	toEditorRange,
	isLocatorRequest,
	isLocatorWebviewMessage,
	isLocatorUriMessage,
	getWebviewHtml,
};

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri(uri: vscode.Uri) {
				didHandleLocatorUri = true;

				const action =
					uri.path === "/open"
						? openLocatorRange(uri)
						: uri.path === "/webview"
							? Promise.resolve(openLocatorWebview(context, uri))
							: undefined;

				if (!action) {
					return;
				}

				return Promise.resolve(action).catch((error) => {
					const message =
						error instanceof Error ? error.message : "Unknown Locator error.";
					void vscode.window.showErrorMessage(`LocatorJS: ${message}`);
				});
			},
		}),
	);

	globalThis.setTimeout(() => {
		void autoOpenConfiguredPreview(context);
	}, 250);
}

export function deactivate() {}
