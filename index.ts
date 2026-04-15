import { type PluginObj, type PluginPass, transformSync } from "@babel/core";
import type { NodePath } from "@babel/traverse";
import type {
	JSXAttribute,
	JSXOpeningElement,
	JSXSpreadAttribute,
} from "@babel/types";
import type { AdapterId } from "@locator/runtime/dist/consts";
import type { Target } from "@locator/shared";
import type { FrameMasterPlugin } from "frame-master/plugin";

export type UIFlowPluginConfig = {
	env: "windows" | "wsl" | "linux";
	editor: "vscode" | "cursor" | string;
	useRangeHandler?: boolean;
	useWebview?: boolean;
	webviewUrl?: string;
	webviewTitle?: string;
};

const VSCODE_URI_HANDLER_ID =
	"m2tech-solutions.frame-master-react-ui-flow-locator-range-handler";
const FRAME_MASTER_WEBVIEW_MODE_QUERY_KEY = "frameMasterPreview";
const FRAME_MASTER_WEBVIEW_MODE_QUERY_VALUE = "vscode";
const FRAME_MASTER_WEBVIEW_MESSAGE_TYPE = "frame-master-open-locator-uri";

type LocatorRuntimeConfig = {
	adapter?: AdapterId;
	targets?: {
		[k: string]: Target | string;
	};
	projectPath?: string;
	showIntro?: boolean;
};

function getEditorLabel(editor: string) {
	if (editor.toLowerCase() === "vscode") {
		return "VS Code";
	}

	if (editor.toLowerCase() === "cursor") {
		return "Cursor";
	}

	return editor.charAt(0).toUpperCase() + editor.slice(1);
}

function getEditorScheme(editor: string) {
	return editor.toLowerCase();
}

function getWslDistroName() {
	return process.env.WSL_DISTRO_NAME || "Ubuntu";
}

function getDefaultVSCodeTargetUrl(config: UIFlowPluginConfig) {
	const projectPath = "$" + "{projectPath}";
	const filePath = "$" + "{filePath}";
	const line = "$" + "{line}";
	const column = "$" + "{column}";

	if (config.env === "wsl") {
		const distro = encodeURIComponent(getWslDistroName());
		return `vscode://vscode-remote/wsl+${distro}${projectPath}${filePath}:${line}:${column}`;
	}

	return `vscode://file/${projectPath}${filePath}:${line}:${column}`;
}

function getVSCodeExtensionTargetUrl(
	path: "/open" | "/webview",
	config: UIFlowPluginConfig,
) {
	const projectPath = "$" + "{projectPath}";
	const filePath = "$" + "{filePath}";
	const line = "$" + "{line}";
	const column = "$" + "{column}";
	const queryParams = [`env=${config.env}`];

	if (path === "/webview") {
		if (config.webviewUrl) {
			queryParams.push(`previewUrl=${encodeURIComponent(config.webviewUrl)}`);
		}

		if (config.webviewTitle) {
			queryParams.push(
				`previewTitle=${encodeURIComponent(config.webviewTitle)}`,
			);
		}
	}

	if (config.env === "wsl") {
		const distro = encodeURIComponent(getWslDistroName());
		queryParams.push(`distro=${distro}`);
		return `vscode://${VSCODE_URI_HANDLER_ID}${path}?projectPath=${projectPath}&filePath=${filePath}&line=${line}&column=${column}&${queryParams.join("&")}`;
	}

	return `vscode://${VSCODE_URI_HANDLER_ID}${path}?projectPath=${projectPath}&filePath=${filePath}&line=${line}&column=${column}&${queryParams.join("&")}`;
}

function getTargetLabel(config: UIFlowPluginConfig) {
	if (config.editor === "vscode" && config.useWebview) {
		return "VS Code Webview";
	}

	return getEditorLabel(config.editor);
}

function getLocatorTargetUrl(config: UIFlowPluginConfig) {
	const projectPath = "$" + "{projectPath}";
	const filePath = "$" + "{filePath}";
	const line = "$" + "{line}";
	const column = "$" + "{column}";

	if (config.editor === "vscode" && config.useWebview) {
		return getVSCodeExtensionTargetUrl("/webview", config);
	}

	if (config.editor === "vscode" && !config.useRangeHandler) {
		return getDefaultVSCodeTargetUrl(config);
	}

	if (config.editor === "vscode") {
		return getVSCodeExtensionTargetUrl("/open", config);
	}

	return `${getEditorScheme(config.editor)}://file/${projectPath}${filePath}:${line}:${column}`;
}

function getLocatorRuntimeConfig(
	config: UIFlowPluginConfig,
): LocatorRuntimeConfig {
	return {
		targets: {
			[config.editor]: {
				label: getTargetLabel(config),
				url: getLocatorTargetUrl(config),
			},
		},
	};
}

function serializeForInlineScript(value: unknown) {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

function resolveSourcePath(filePath: string) {
	const match = filePath.match(/\/_([^/]+)_\.(tsx|jsx)$/);
	if (!match) {
		return filePath;
	}

	const [, name, extension] = match;
	return filePath.replace(/\/_([^/]+)_\.(tsx|jsx)$/, `/${name}.${extension}`);
}

function getHighlightLocation(path: NodePath<JSXOpeningElement>) {
	if (path.parentPath.isJSXElement() && path.parentPath.node.loc) {
		return path.parentPath.node.loc;
	}

	return path.node.loc ?? null;
}

function UIFlowPlugin(config: UIFlowPluginConfig): FrameMasterPlugin {
	const locatorConfig = serializeForInlineScript(
		getLocatorRuntimeConfig(config),
	);
	const webviewBridgeConfig = serializeForInlineScript({
		extensionId: VSCODE_URI_HANDLER_ID,
		messageType: FRAME_MASTER_WEBVIEW_MESSAGE_TYPE,
		previewModeQueryKey: FRAME_MASTER_WEBVIEW_MODE_QUERY_KEY,
		previewModeQueryValue: FRAME_MASTER_WEBVIEW_MODE_QUERY_VALUE,
	});

	return {
		name: "react-ui-flow-dev",
		version: "0.1.0",
		build: {
			buildConfig: {
				entrypoints: ["/@frame-master-plugin-react-ui-flow-react.js"],
				files: {
					"/@frame-master-plugin-react-ui-flow-react.js": `
                    import setup from "@locator/runtime";

					const locatorConfig = ${locatorConfig};
					const webviewBridgeConfig = ${webviewBridgeConfig};

					function isVSCodePreviewMode() {
						const search = typeof window === "undefined" ? "" : window.location.search;
						const params = new URLSearchParams(search);
						return params.get(webviewBridgeConfig.previewModeQueryKey) === webviewBridgeConfig.previewModeQueryValue;
					}

					function getBridgeHref(value) {
						if (typeof value !== "string") {
							return null;
						}

						return value.startsWith("vscode://" + webviewBridgeConfig.extensionId + "/") ? value : null;
					}

					function postLocatorHref(href) {
						if (typeof window === "undefined" || window.parent === window) {
							return;
						}

						window.parent.postMessage(
							{
								type: webviewBridgeConfig.messageType,
								href,
							},
							"*",
						);
					}

					function installVSCodeWebviewBridge() {
						if (
							typeof window === "undefined" ||
							typeof document === "undefined" ||
							window.parent === window ||
							!isVSCodePreviewMode() ||
							window.__FRAME_MASTER_UI_FLOW_BRIDGE_INSTALLED__
						) {
							return;
						}

						window.__FRAME_MASTER_UI_FLOW_BRIDGE_INSTALLED__ = true;

						const originalOpen = typeof window.open === "function"
							? window.open.bind(window)
							: null;

						window.open = function patchedOpen(url, target, features) {
							const href = getBridgeHref(
								typeof url === "string" ? url : url?.toString?.(),
							);

							if (href) {
								postLocatorHref(href);
								return null;
							}

							return originalOpen ? originalOpen(url, target, features) : null;
						};

						document.addEventListener(
							"click",
							(event) => {
								const target = event.target instanceof Element
									? event.target.closest("a[href]")
									: null;

								if (!target) {
									return;
								}

								const href = getBridgeHref(target.href);

								if (!href) {
									return;
								}

								event.preventDefault();
								event.stopPropagation();
								event.stopImmediatePropagation?.();
								postLocatorHref(href);
							},
							true,
						);
					}

					export default () => {
						installVSCodeWebviewBridge();
						return setup(locatorConfig);
					};
                    `,
				},
				plugins: [
					{
						name: "UI-flow-build",
						setup(build) {
							// build.onResolve({ filter: /\.tsx$/ }, (args) => {
							build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
								const sourcePath = resolveSourcePath(args.path);
								let originalCode: string | undefined;
								try {
									originalCode = await Bun.file(sourcePath).text();
								} catch {
									originalCode = undefined;
								}
								const chainedCode = args.__chainedContents as
									| string
									| undefined;
								const hasGeneratedMarkup =
									!!chainedCode && /^\s*</.test(chainedCode);
								const code =
									sourcePath !== args.path
										? originalCode
										: chainedCode && !hasGeneratedMarkup
											? chainedCode
											: originalCode;
								const fallbackLoader = args.path.endsWith(".tsx")
									? "tsx"
									: "jsx";

								if (!code) {
									return;
								}

								const result = transformSync(code, {
									filename: sourcePath,
									plugins: [
										function customSourcePlugin(babel: {
											types: typeof import("@babel/types");
										}): PluginObj<PluginPass> {
											const { types: t } = babel;
											const hasAttribute = (
												attribute: JSXAttribute | JSXSpreadAttribute,
												attributeName: string,
											) => {
												if (attribute.type !== "JSXAttribute") {
													return false;
												}

												const { name } = attribute;
												return (
													t.isJSXIdentifier(name) && name.name === attributeName
												);
											};

											return {
												visitor: {
													JSXOpeningElement(
														path: NodePath<JSXOpeningElement>,
														state: PluginPass,
													) {
														const filePath = state.filename || "";
														const location = getHighlightLocation(path)?.start;

														if (!filePath || !location) {
															return;
														}

														const hasLocatorAttribute =
															path.node.attributes.some(
																(
																	attribute: JSXAttribute | JSXSpreadAttribute,
																) => hasAttribute(attribute, "data-locatorjs"),
															);
														const hasSourcePathAttribute =
															path.node.attributes.some(
																(
																	attribute: JSXAttribute | JSXSpreadAttribute,
																) =>
																	hasAttribute(attribute, "data-source-path"),
															);

														if (!hasLocatorAttribute) {
															path.node.attributes.push(
																t.jsxAttribute(
																	t.jsxIdentifier("data-locatorjs"),
																	t.stringLiteral(
																		`${filePath}:${location.line}:${location.column}`,
																	),
																),
															);
														}

														if (!hasSourcePathAttribute) {
															path.node.attributes.push(
																t.jsxAttribute(
																	t.jsxIdentifier("data-source-path"),
																	t.stringLiteral(filePath),
																),
															);
														}
													},
												},
											};
										},
									],
									presets: [
										"@babel/preset-typescript",
										["@babel/preset-react", { runtime: "automatic" }],
									],
								});

								//console.log(result?.code);

								return {
									contents: result?.code || code,
									loader: result?.code ? "js" : fallbackLoader,
								};
							});
						},
					},
				],
			},
		},
	};
}

export function setupUIFlow() {
	const isClient = typeof window !== "undefined";
	const path = isClient ? "/@frame-master-plugin-react-ui-flow-react.js" : "";
	if (!isClient) return;
	return import(path).then(({ default: setupLocatorUI }) => setupLocatorUI());
}

export default UIFlowPlugin;
