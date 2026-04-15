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

type LocatorWebviewControlMessage = {
	type: "navigate-back" | "navigate-forward" | "reload-preview";
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

type PreviewMarkerPayload = {
	type: string;
	previewUrl: string;
	previewTitle?: string;
};

const WEBVIEW_PANEL_VIEW_TYPE =
	"frameMasterReactUiFlowLocatorRangeHandler.preview";
const WEBVIEW_PANEL_TITLE = "Frame Master UI Flow";
const PREVIEW_BACK_COMMAND =
	"frameMasterReactUiFlowLocatorRangeHandler.previewBack";
const PREVIEW_FORWARD_COMMAND =
	"frameMasterReactUiFlowLocatorRangeHandler.previewForward";
const PREVIEW_RELOAD_COMMAND =
	"frameMasterReactUiFlowLocatorRangeHandler.previewReload";
const PREVIEW_URL_QUERY_KEY = "previewUrl";
const PREVIEW_TITLE_QUERY_KEY = "previewTitle";
const PREVIEW_MODE_QUERY_KEY = "frameMasterPreview";
const PREVIEW_MODE_QUERY_VALUE = "vscode";
const PREVIEW_BRIDGE_MESSAGE_TYPE = "frame-master-open-locator-uri";
const PREVIEW_LOCATION_MESSAGE_TYPE = "frame-master-preview-location";
const PREVIEW_AUTO_OPEN_POLL_INTERVAL_MS = 1000;
const PREVIEW_AUTO_OPEN_TIMEOUT_MS = 5 * 60 * 1000;
const PREVIEW_REACHABILITY_TIMEOUT_MS = 1500;
const FRAME_MASTER_CONFIG_FILE_NAMES = [
	"frame-master.config.ts",
	"frame-master.config.mts",
	"frame-master.config.js",
	"frame-master.config.mjs",
];
const PREVIEW_MARKER_BASENAME = "frame-master-react-ui-flow.preview.json";
const PREVIEW_MARKER_TYPE = "frame-master-react-ui-flow.preview";

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

async function resolveLocatorPanelState(state: LocatorPanelState) {
	if (!state.previewUrl) {
		return state;
	}

	try {
		const previewUri = vscode.Uri.parse(state.previewUrl);

		if (previewUri.scheme !== "http" && previewUri.scheme !== "https") {
			return state;
		}

		const externalPreviewUri = await vscode.env.asExternalUri(previewUri);

		return createLocatorPanelState(
			externalPreviewUri.toString(),
			state.previewTitle,
			state.request,
			state.configPath,
		);
	} catch {
		return state;
	}
}

function parseLocatorPanelState(uri: vscode.Uri): LocatorPanelState {
	const params = new URLSearchParams(uri.query);
	const previewUrl = getQueryValue(params, PREVIEW_URL_QUERY_KEY);
	const previewTitle = getQueryValue(params, PREVIEW_TITLE_QUERY_KEY);
	const request = parseLocatorRequest(uri);

	return createLocatorPanelState(previewUrl, previewTitle, request);
}

function parsePreviewPanelState(uri: vscode.Uri): LocatorPanelState {
	const params = new URLSearchParams(uri.query);
	const previewUrl = getQueryValue(params, PREVIEW_URL_QUERY_KEY);
	const previewTitle = getQueryValue(params, PREVIEW_TITLE_QUERY_KEY);

	return createLocatorPanelState(previewUrl, previewTitle);
}

function isPreviewMarkerDocument(document: vscode.TextDocument) {
	return (
		document.uri.scheme === "file" &&
		normalizePosixPath(document.uri.fsPath).endsWith(
			`/.frame-master/${PREVIEW_MARKER_BASENAME}`,
		)
	);
}

function parsePreviewMarkerPayload(sourceText: string) {
	try {
		const payload = JSON.parse(sourceText) as PreviewMarkerPayload;

		if (
			payload.type !== PREVIEW_MARKER_TYPE ||
			typeof payload.previewUrl !== "string" ||
			payload.previewUrl.length === 0
		) {
			return undefined;
		}

		return createLocatorPanelState(
			payload.previewUrl,
			typeof payload.previewTitle === "string"
				? payload.previewTitle
				: WEBVIEW_PANEL_TITLE,
		);
	} catch {
		return undefined;
	}
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

function isLocatorWebviewControlMessage(
	value: unknown,
): value is LocatorWebviewControlMessage {
	return (
		!!value &&
		typeof value === "object" &&
		((value as LocatorWebviewControlMessage).type === "navigate-back" ||
			(value as LocatorWebviewControlMessage).type === "navigate-forward" ||
			(value as LocatorWebviewControlMessage).type === "reload-preview")
	);
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;");
}

function getOpenDocumentViewColumn(
	documentUri: vscode.Uri,
	excludedViewColumn?: vscode.ViewColumn,
) {
	for (const editor of vscode.window.visibleTextEditors) {
		if (
			editor.document.uri.toString() === documentUri.toString() &&
			editor.viewColumn !== undefined &&
			editor.viewColumn !== excludedViewColumn
		) {
			return editor.viewColumn;
		}
	}

	for (const tabGroup of vscode.window.tabGroups.all) {
		if (
			tabGroup.viewColumn === undefined ||
			tabGroup.viewColumn === excludedViewColumn
		) {
			continue;
		}

		for (const tab of tabGroup.tabs) {
			if (
				tab.input instanceof vscode.TabInputText &&
				tab.input.uri.toString() === documentUri.toString()
			) {
				return tabGroup.viewColumn;
			}
		}
	}

	return undefined;
}

function getAlternateEditorGroupViewColumn(
	excludedViewColumn?: vscode.ViewColumn,
) {
	for (const tabGroup of vscode.window.tabGroups.all) {
		if (
			tabGroup.viewColumn !== undefined &&
			tabGroup.viewColumn !== excludedViewColumn
		) {
			return tabGroup.viewColumn;
		}
	}

	return undefined;
}

function getLocatorRequestViewColumn(documentUri: vscode.Uri) {
	const webviewViewColumn = locatorWebviewPanel?.viewColumn;
	const existingDocumentViewColumn = getOpenDocumentViewColumn(
		documentUri,
		webviewViewColumn,
	);

	if (existingDocumentViewColumn !== undefined) {
		return existingDocumentViewColumn;
	}

	const alternateViewColumn =
		getAlternateEditorGroupViewColumn(webviewViewColumn);

	if (alternateViewColumn !== undefined) {
		return alternateViewColumn;
	}

	if (webviewViewColumn !== undefined) {
		return vscode.ViewColumn.Beside;
	}

	return vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
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
	const viewColumn = getLocatorRequestViewColumn(documentUri);
	const editor = await vscode.window.showTextDocument(document, {
		viewColumn,
		preview: false,
		preserveFocus: true,
		selection,
	});
	editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
	locatorWebviewPanel?.reveal(locatorWebviewPanel.viewColumn, true);
}

function getWebviewHtml(state: LocatorPanelState) {
	const previewTitle = escapeHtml(state.previewTitle || WEBVIEW_PANEL_TITLE);
	const locationLabel = state.request
		? `${state.request.startLine}:${state.request.startColumnOneBased}`
		: "";
	const previewSourceUrl = state.previewSourceUrl
		? escapeHtml(state.previewSourceUrl)
		: "";
	const previewOriginJson = JSON.stringify(state.previewOrigin)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e");
	const bridgeMessageTypeJson = JSON.stringify(PREVIEW_BRIDGE_MESSAGE_TYPE);
	const previewLocationMessageTypeJson = JSON.stringify(
		PREVIEW_LOCATION_MESSAGE_TYPE,
	);
	const navigateBackTypeJson = JSON.stringify("navigate-back");
	const navigateForwardTypeJson = JSON.stringify("navigate-forward");
	const reloadPreviewTypeJson = JSON.stringify("reload-preview");
	const requestMetaAttributes = state.request
		? ` data-source-path="${escapeHtml(state.request.fullPath)}" data-source-location="${escapeHtml(locationLabel)}"`
		: state.configPath
			? ` data-config-path="${escapeHtml(state.configPath)}"`
			: "";
	const iframeMarkup = state.previewSourceUrl
		? `<iframe id="preview-frame" src="about:blank" data-src="${previewSourceUrl}" title="${previewTitle}"${requestMetaAttributes}></iframe>`
		: `<section class="empty-state"><p>No preview URL was configured for this webview target.</p><p>Add <code>webviewUrl</code> to the plugin config to load your local app inside VS Code.</p></section>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${previewTitle}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https: http:; frame-src https: http:; connect-src https: http:;">
<style>
	html,
	body {
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: var(--vscode-editor-background);
	}
	body {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}
	.preview-toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
		background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
	}
	.preview-toolbar form {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
	}
	.preview-toolbar label {
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
	}
	.preview-toolbar input {
		width: 100%;
		min-width: 0;
		height: 34px;
		padding: 0 12px;
		border-radius: 10px;
		border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.12));
		background: var(--vscode-input-background, rgba(255, 255, 255, 0.04));
		color: var(--vscode-input-foreground, var(--vscode-editor-foreground));
		outline: none;
	}
	.preview-toolbar input:focus {
		border-color: var(--vscode-focusBorder, #007acc);
	}
	.preview-toolbar button {
		height: 34px;
		padding: 0 14px;
		border: 0;
		border-radius: 10px;
		background: var(--vscode-button-background, #0e639c);
		color: var(--vscode-button-foreground, white);
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.preview-toolbar button:hover {
		background: var(--vscode-button-hoverBackground, #1177bb);
	}
	.preview-frame-shell {
		position: relative;
		min-height: 0;
	}
	iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: white;
	}
	code {
		font-family: "Courier New", monospace;
		font-size: 0.92em;
	}
	.empty-state {
		height: 100vh;
		display: grid;
		place-content: center;
		gap: 10px;
		padding: 32px;
		text-align: center;
		color: var(--vscode-editor-foreground);
		background: var(--vscode-editor-background);
	}
	.status-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 10px;
		padding: 32px;
		text-align: center;
		color: var(--vscode-editor-foreground);
		background: var(--vscode-editor-background);
		z-index: 1;
	}
	.status-overlay[hidden] {
		display: none;
	}
	.status-overlay code {
		overflow-wrap: anywhere;
	}
</style>
</head>
<body>
	<header class="preview-toolbar">
		<form id="location-form">
			<label for="location-input">Route</label>
			<input id="location-input" type="text" spellcheck="false" value="${previewSourceUrl}" placeholder="/dashboard or https://..." />
			<button type="submit">Go</button>
		</form>
	</header>
	<div class="preview-frame-shell">
		<div id="status-overlay" class="status-overlay"${state.previewSourceUrl ? "" : " hidden"}>
			<p id="status-title">Loading preview...</p>
			<p id="status-body"><code>${previewSourceUrl}</code></p>
		</div>
		${iframeMarkup}
	</div>
<script>
	const vscode = acquireVsCodeApi();
	const previewOrigin = ${previewOriginJson};
	const bridgeMessageType = ${bridgeMessageTypeJson};
	const previewLocationMessageType = ${previewLocationMessageTypeJson};
	const navigateBackType = ${navigateBackTypeJson};
	const navigateForwardType = ${navigateForwardTypeJson};
	const reloadPreviewType = ${reloadPreviewTypeJson};
	const previewFrame = document.getElementById("preview-frame");
	const locationForm = document.getElementById("location-form");
	const locationInput = document.getElementById("location-input");
	const statusOverlay = document.getElementById("status-overlay");
	const statusTitle = document.getElementById("status-title");
	const statusBody = document.getElementById("status-body");
	let loadTimeout = 0;
	let hasLoadedPreview = false;
	let hasStartedPreview = false;
	let hasRetriedPendingPreview = false;

	function escapeStatusHtml(value) {
		return value.replace(/[&<>"]/g, (char) => {
			if (char === "&") {
				return "&amp;";
			}

			if (char === "<") {
				return "&lt;";
			}

			if (char === ">") {
				return "&gt;";
			}

			return "&quot;";
		});
	}

	function setStatus(title, body) {
		if (!(statusOverlay instanceof HTMLElement) || !(statusTitle instanceof HTMLElement) || !(statusBody instanceof HTMLElement)) {
			return;
		}

		statusTitle.textContent = title;
		statusBody.innerHTML = body ? "<code>" + escapeStatusHtml(body) + "</code>" : "";
		statusOverlay.hidden = false;
	}

	function clearStatus() {
		if (statusOverlay instanceof HTMLElement) {
			statusOverlay.hidden = true;
		}
	}

	function getPreviewTargetUrl() {
		if (!(previewFrame instanceof HTMLIFrameElement)) {
			return "";
		}

		return previewFrame.dataset.src || "";
	}

	function armPreviewTimeout(targetUrl) {
		window.clearTimeout(loadTimeout);
		loadTimeout = window.setTimeout(() => {
			setStatus("Preview did not finish loading.", targetUrl);
		}, 4000);
	}

	function loadPreviewTarget(forceReload) {
		const targetUrl = getPreviewTargetUrl();

		if (!(previewFrame instanceof HTMLIFrameElement) || !targetUrl) {
			return;
		}

		hasStartedPreview = true;
		hasLoadedPreview = false;
		setStatus("Loading preview...", targetUrl);
		armPreviewTimeout(targetUrl);

		const assignTarget = () => {
			previewFrame.src = targetUrl;
		};

		if (forceReload) {
			previewFrame.src = "about:blank";
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(assignTarget);
			});
			return;
		}

		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(assignTarget);
		});
	}

	function updateLocationInput(value) {
		if (locationInput instanceof HTMLInputElement) {
			locationInput.value = value;
		}
	}

	function buildPreviewLocation(rawValue) {
		const value = rawValue.trim();

		if (!value) {
			return "";
		}

		const targetUrl = getPreviewTargetUrl();
		const baseUrl = targetUrl || ${JSON.stringify(state.previewSourceUrl)};
		const parsedUrl =
			value.startsWith("http://") || value.startsWith("https://")
			? new URL(value)
			: new URL(value, baseUrl);

		parsedUrl.searchParams.set(${JSON.stringify(PREVIEW_MODE_QUERY_KEY)}, ${JSON.stringify(PREVIEW_MODE_QUERY_VALUE)});
		return parsedUrl.toString();
	}

	function navigateToManualLocation(rawValue) {
		const nextUrl = buildPreviewLocation(rawValue);

		if (!nextUrl || !(previewFrame instanceof HTMLIFrameElement)) {
			return;
		}

		previewFrame.dataset.src = nextUrl;
		updateLocationInput(nextUrl);
		loadPreviewTarget(true);
	}

	function ensurePreviewStarted() {
		if (document.visibilityState !== "visible" || hasStartedPreview) {
			return;
		}

		loadPreviewTarget(false);
	}

	if (previewFrame instanceof HTMLIFrameElement && getPreviewTargetUrl()) {
		updateLocationInput(getPreviewTargetUrl());
		ensurePreviewStarted();

		previewFrame.addEventListener("load", () => {
			window.clearTimeout(loadTimeout);
			hasLoadedPreview = true;
			hasRetriedPendingPreview = false;
			clearStatus();
		});

		previewFrame.addEventListener("error", () => {
			window.clearTimeout(loadTimeout);
			hasLoadedPreview = false;
			setStatus("Preview failed to load.", getPreviewTargetUrl());
		});

		document.addEventListener("visibilitychange", () => {
			ensurePreviewStarted();
		});

		window.addEventListener("pageshow", () => {
			ensurePreviewStarted();
		});

		window.addEventListener("resize", () => {
			if (!hasStartedPreview || hasLoadedPreview || hasRetriedPendingPreview) {
				return;
			}

			hasRetriedPendingPreview = true;
			loadPreviewTarget(true);
		});
	}

	if (locationForm instanceof HTMLFormElement) {
		locationForm.addEventListener("submit", (event) => {
			event.preventDefault();

			if (!(locationInput instanceof HTMLInputElement)) {
				return;
			}

			navigateToManualLocation(locationInput.value);
		});
	}

	window.addEventListener("message", (event) => {
		const data = event.data;

		if (data && typeof data === "object") {
			if (data.type === navigateBackType) {
				previewFrame instanceof HTMLIFrameElement && previewFrame.contentWindow?.postMessage({ type: navigateBackType }, previewOrigin || "*");
				return;
			}

			if (data.type === navigateForwardType) {
				previewFrame instanceof HTMLIFrameElement && previewFrame.contentWindow?.postMessage({ type: navigateForwardType }, previewOrigin || "*");
				return;
			}

			if (data.type === reloadPreviewType) {
				if (previewFrame instanceof HTMLIFrameElement && previewFrame.src) {
					previewFrame.contentWindow?.postMessage({ type: reloadPreviewType }, previewOrigin || "*");
				}
				return;
			}
		}

		if (previewOrigin && event.origin !== previewOrigin) {
			return;
		}

		if (!data || typeof data !== "object") {
			return;
		}

		if (data.type === previewLocationMessageType && typeof data.href === "string") {
			updateLocationInput(data.href);
			if (previewFrame instanceof HTMLIFrameElement) {
				previewFrame.dataset.src = data.href;
			}
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

function getPreferredWebviewViewColumn() {
	return (
		vscode.window.activeTextEditor?.viewColumn ||
		vscode.window.tabGroups.activeTabGroup.viewColumn ||
		vscode.ViewColumn.One
	);
}

async function showLocatorWebviewPanel(
	context: vscode.ExtensionContext,
	state: LocatorPanelState,
) {
	const resolvedState = await resolveLocatorPanelState(state);
	const preferredViewColumn = getPreferredWebviewViewColumn();

	if (!locatorWebviewPanel) {
		locatorWebviewPanel = vscode.window.createWebviewPanel(
			WEBVIEW_PANEL_VIEW_TYPE,
			WEBVIEW_PANEL_TITLE,
			{
				viewColumn: preferredViewColumn,
				preserveFocus: false,
			},
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

	locatorWebviewPanel.title = resolvedState.request
		? `${resolvedState.previewTitle}: ${resolvedState.request.startLine}:${resolvedState.request.startColumnOneBased}`
		: resolvedState.previewTitle;
	locatorWebviewPanel.webview.html = getWebviewHtml(resolvedState);
	locatorWebviewPanel.reveal(preferredViewColumn, false);
}

function findTabForDocument(uri: vscode.Uri) {
	for (const tabGroup of vscode.window.tabGroups.all) {
		for (const tab of tabGroup.tabs) {
			if (
				tab.input instanceof vscode.TabInputText &&
				tab.input.uri.toString() === uri.toString()
			) {
				return tab;
			}
		}
	}

	return undefined;
}

async function closePreviewMarkerTab(uri: vscode.Uri) {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const tab = findTabForDocument(uri);

		if (tab) {
			await vscode.window.tabGroups.close(tab, true);
			return;
		}

		await new Promise<void>((resolve) => {
			globalThis.setTimeout(resolve, 50);
		});
	}
}

async function maybeOpenPreviewMarkerDocument(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
) {
	if (!isPreviewMarkerDocument(document)) {
		return;
	}

	const state = parsePreviewMarkerPayload(document.getText());

	if (!state) {
		return;
	}

	didHandleLocatorUri = true;
	await showLocatorWebviewPanel(context, state);
	await closePreviewMarkerTab(document.uri);
}

function openLocatorWebview(context: vscode.ExtensionContext, uri: vscode.Uri) {
	void showLocatorWebviewPanel(context, parseLocatorPanelState(uri));
}

function postLocatorWebviewControlMessage(
	message: LocatorWebviewControlMessage,
) {
	if (!locatorWebviewPanel) {
		return;
	}

	void locatorWebviewPanel.webview.postMessage(message);
	locatorWebviewPanel.reveal(locatorWebviewPanel.viewColumn, true);
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

			await showLocatorWebviewPanel(
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
	parsePreviewPanelState,
	isPreviewMarkerDocument,
	parsePreviewMarkerPayload,
	parseAutoOpenPreviewConfigs,
	createLocatorPanelState,
	resolveLocatorPanelState,
	findAutoOpenPreviewConfig,
	shouldAutoOpenForPreviewResponse,
	appendQueryValue,
	getOpenDocumentViewColumn,
	getAlternateEditorGroupViewColumn,
	getLocatorRequestViewColumn,
	getSelectionRange,
	toEditorRange,
	isLocatorRequest,
	isLocatorWebviewMessage,
	isLocatorUriMessage,
	isLocatorWebviewControlMessage,
	getWebviewHtml,
};

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(PREVIEW_BACK_COMMAND, () => {
			postLocatorWebviewControlMessage({ type: "navigate-back" });
		}),
		vscode.commands.registerCommand(PREVIEW_FORWARD_COMMAND, () => {
			postLocatorWebviewControlMessage({ type: "navigate-forward" });
		}),
		vscode.commands.registerCommand(PREVIEW_RELOAD_COMMAND, () => {
			postLocatorWebviewControlMessage({ type: "reload-preview" });
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			void maybeOpenPreviewMarkerDocument(context, document);
		}),
	);

	for (const document of vscode.workspace.textDocuments) {
		void maybeOpenPreviewMarkerDocument(context, document);
	}

	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri(uri: vscode.Uri) {
				didHandleLocatorUri = true;

				const action =
					uri.path === "/open"
						? openLocatorRange(uri)
						: uri.path === "/preview"
							? Promise.resolve(
									showLocatorWebviewPanel(context, parsePreviewPanelState(uri)),
								)
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
