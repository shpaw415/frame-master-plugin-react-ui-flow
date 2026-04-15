# Quick Example

Install the plugin:

```bash
bun add frame-master-plugin-react-ui-flow
```

Register it in your Frame Master config:

```ts
import type { FrameMasterConfig } from "frame-master/server/types";
import UIFlowPlugin from "frame-master-plugin-react-ui-flow";

const config: FrameMasterConfig = {
	HTTPServer: {
		port: 3000,
	},
	plugins: [
		UIFlowPlugin({
			env: "linux",
			editor: "vscode",
			useWebview: true,
			webviewUrl: "http://127.0.0.1:3000",
			webviewTitle: "My App Preview",
		}),
	],
};

export default config;
```

Start LocatorJS on the client:

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

With the companion VS Code extension installed, LocatorJS clicks open the VS Code preview webview, let you navigate inside the preview, and jump back to the matching source location.