# frame-master-react-ui-flow

React UI flow plugin for Frame-Master.

This plugin wires LocatorJS into a Frame-Master React app so you can inspect rendered UI in the browser and jump straight to the source file in your editor. It supports Linux, Windows, and WSL workflows and can target VS Code, Cursor, or any editor that exposes a compatible URI scheme.

## What it does

- Injects `data-locatorjs` and `data-source-path` attributes into JSX and TSX during the Frame-Master build.
- Serves a small client bootstrap that starts the LocatorJS runtime in the browser.
- Generates editor links for local file targets and WSL remote targets.
- Optionally integrates with the companion VS Code URI handler extension to select the full JSX element instead of only moving the cursor.

## Installation

Install the plugin in your Frame-Master project:

```bash
bun add frame-master-react-ui-flow
```

`frame-master` is a peer dependency and must already be installed in the host project.

## Server-side usage

Register the plugin in your Frame-Master config and provide the target environment and editor.

```ts
import type { FrameMasterConfig } from "frame-master/server/types";
import UIFlowPlugin from "frame-master-react-ui-flow";

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
import { setupUIFlow } from "frame-master-react-ui-flow";

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

## Optional VS Code range handler

When `editor: "vscode"` and `useRangeHandler: true`, the plugin targets the local URI handler extension with the id:

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

If you are working with WSL, install the extension into the local desktop VS Code UI host, not only the remote WSL extension host.

## Example setups

### Linux + VS Code

```ts
UIFlowPlugin({
  env: "linux",
  editor: "vscode",
  useRangeHandler: true,
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

When the optional VS Code URI handler is installed, the URI target opens the file and expands the selection to the full JSX element or fragment that begins at that source location.

## License

MIT
