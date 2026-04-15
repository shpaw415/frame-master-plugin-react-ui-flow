import type { FrameMasterConfig } from "frame-master/server/types";
import UIFlowPlugin from "frame-master-plugin-react-ui-flow";

const config: FrameMasterConfig = {
	HTTPServer: {
		port: 3000,
	},
	plugins: [
		UIFlowPlugin({
			env: "wsl",
			editor: "vscode",
			useRangeHandler: false,
			useWebview: true,
			webviewUrl: "http://127.0.0.1:3000",
			webviewTitle: "My App",
		}),
	],
};

export default config;