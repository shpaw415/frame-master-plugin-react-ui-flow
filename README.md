# frame-master-plugin-react-ui-flow

React UI flow plugin for Frame-Master.

This plugin wires LocatorJS into a Frame-Master React app so you can inspect rendered UI in the browser and jump straight to the source file in your editor. It supports Linux, Windows, and WSL workflows and can target VS Code, Cursor, or any editor that exposes a compatible URI scheme.

## What it does

- Injects `data-locatorjs` and `data-source-path` attributes into JSX and TSX during the Frame-Master build.
- Serves a small client bootstrap that starts the LocatorJS runtime in the browser.
- Generates editor links for local file targets and WSL remote targets.
- Optionally integrates with the companion VS Code URI handler extension to select the full JSX element instead of only moving the cursor.
- Can open a live VS Code webview preview with back, forward, reload, and manual route navigation controls.
- Keeps the preview route field in sync with in-app navigation inside the iframe.
- Reuses an already open editor tab when LocatorJS jumps to a file, or opens the file in a separate editor group instead of replacing the preview.

## Installation

Install the plugin in your Frame-Master project:

```bash
bun add frame-master-plugin-react-ui-flow
```

`frame-master` is a peer dependency and must already be installed in the host project.

## Quick Start

See the ready-to-copy examples in:

- `QUICK_EXEMPLE.md`
- `CONFIG_EXEMPLE.md`

## Server-side usage

Register the plugin in your Frame-Master config and provide the target environment and editor.

```ts
import type { FrameMasterConfig } from "frame-master/server/types";
import UIFlowPlugin from "frame-master-plugin-react-ui-flow";

const config: FrameMasterConfig = {
  HTTPServer: { port: 3000 },
  plugins: [
    UIFlowPlugin({
      env: "linux",
      editor: "vscode",
      useRangeHandler: true,
    }),
  ],
};

export default config;
```

## Client-side bootstrap

The plugin also exports `setupUIFlow()`. Call it once on the client after your app mounts so LocatorJS starts in the browser.

```tsx
import { useEffect } from "react";
import { setupUIFlow } from "frame-master-plugin-react-ui-flow";

export function ClientWrapper({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setupUIFlow();
  }, []);

  return <>{children}</>;
}
```

## Configuration

### `env`

Controls how file paths are converted into editor links.

- `linux`: generates local Linux file targets.
- `windows`: generates local Windows file targets.
- `wsl`: generates WSL-aware targets and remote URIs when needed.

### `editor`

Controls the editor URI scheme.

- `vscode`: generates VS Code links.
- `cursor`: generates Cursor links.
- any other string: treated as a custom URI scheme.

### `useRangeHandler`

Optional boolean.

- `false` or omitted: VS Code links use the normal `vscode://file/...` or `vscode://vscode-remote/...` format.
- `true`: VS Code links target the companion URI handler extension so the editor can expand the selection to the full JSX node.

### `useWebview`

Optional boolean.

- `false` or omitted: the plugin opens source locations directly through standard VS Code links or the range-handler URI flow.
- `true`: when `editor` is `vscode` or `cursor`, the plugin targets the extension's `/webview` route. The companion extension can open a preview panel, load your app in an iframe, and relay LocatorJS clicks from inside that preview back into the editor.

`useWebview` takes precedence over `useRangeHandler` for VS Code-compatible targets.

### `webviewUrl`

Optional string.

- Used only when `editor` is `vscode` or `cursor` and `useWebview` is `true`.
- The extension loads this URL inside the preview panel iframe.
- The plugin appends `?frameMasterPreview=vscode` or `&frameMasterPreview=vscode` to the URL so the injected bridge can detect preview mode.

Use a URL that the local VS Code UI host can reach. For local development that is typically something like `http://127.0.0.1:3000`.

When the companion extension is installed, `useWebview: true` together with `webviewUrl` also allows the extension to watch that URL on VS Code or Cursor startup and auto-open the preview panel when the dev server becomes reachable.

In addition, the plugin now exposes an internal preview trigger route and uses its `serverStart.dev_main` hook to ping that route once the dev server is up. The route writes a marker file at `.frame-master/frame-master-react-ui-flow.preview.json` and opens that file with `code -r` or `cursor -r` in the current editor instance. The extension watches for that fake file to open, reads the preview options from its JSON payload, opens the preview webview, and then closes the marker tab. The hook is guarded so it only opens once per preview URL in the current process and only when `VSCODE_IPC_HOOK_CLI` is available.

### `webviewTitle`

Optional string.

- Overrides the webview panel title shown by the companion VS Code extension.

## Optional VS Code handler extension

When `editor: "vscode"` or `editor: "cursor"` and either `useRangeHandler: true` or `useWebview: true`, the plugin targets the local URI handler extension with the id:

```text
m2tech-solutions.frame-master-react-ui-flow-locator-range-handler
```

That extension lives in this repository under:

```text
extentions/vscode/locator-range-handler
```

Build and install it locally with:

```bash
cd extentions/vscode/locator-range-handler
npm run package:vsix
code --install-extension frame-master-react-ui-flow-locator-range-handler.vsix --force
```

For Cursor, install the same VSIX with:

```bash
cursor --install-extension frame-master-react-ui-flow-locator-range-handler.vsix --force
```

If you are working with WSL, install the extension into the local desktop VS Code UI host, not only the remote WSL extension host.

## VS Code Webview Features

When `useWebview: true` is enabled and the companion extension is installed, the preview panel supports:

- automatic preview opening when the dev server becomes reachable
- startup and dev-hook preview opening in the current editor instance
- a top route bar for manually navigating to `/dashboard`, `/login`, or any full URL
- route syncing from the iframe back into the route bar when your app navigates internally
- back, forward, and reload controls in the webview title bar
- file opens that stay out of the preview group and reuse an already open editor tab when possible

## Example setups

### Linux + VS Code

```ts
UIFlowPlugin({
  env: "linux",
  editor: "vscode",
  useRangeHandler: true,
});
```

### Linux + VS Code Webview

```ts
UIFlowPlugin({
  env: "linux",
  editor: "vscode",
  useWebview: true,
  webviewUrl: "http://127.0.0.1:3000",
  webviewTitle: "Certorify Preview",
});
```

### Windows + Cursor

```ts
UIFlowPlugin({
  env: "windows",
  editor: "cursor",
});
```

### WSL + VS Code

```ts
UIFlowPlugin({
  env: "wsl",
  editor: "vscode",
  useRangeHandler: true,
});
```

## How the source mapping works

During transformation, the plugin records the JSX opening location and source file path on each element. LocatorJS uses those attributes in the browser to open the corresponding file and position in the editor.

When the optional VS Code handler extension is installed, the URI target can either open the file directly or load a VS Code preview panel. In preview mode, the plugin also installs a browser-side bridge that intercepts LocatorJS VS Code links inside the iframe and relays them back to the parent webview so the extension can still open and expand the matching JSX node. If your workspace config contains `useWebview: true` and a `webviewUrl`, the extension can also wait for that preview URL to come up and open the panel automatically when the dev server becomes reachable.

That preview bridge also reports iframe location changes back to the parent webview, so the route bar stays in sync after client-side navigation.

## License

MIT
