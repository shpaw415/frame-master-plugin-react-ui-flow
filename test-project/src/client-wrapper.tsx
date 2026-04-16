// ClientWrapper is used client side only for state management
// you can create your own version of the routerHost

import { RouterHost } from "frame-master-plugin-apply-react/router";
import { StrictMode, useEffect, type JSX } from "react";
import { setupUIFlow } from "frame-master-plugin-react-ui-flow";

function navigate(path: string) {
	const el = document.createElement("a");
	el.href = path;
	document.body.appendChild(el);
	el.click();
	document.body.removeChild(el);
}

export default function ClientWrapper({ children }: { children: JSX.Element }) {
	useEffect(() => {
		setupUIFlow()?.then(() => {
			navigate(location.href);
		});
	}, []);

	return (
		<StrictMode>
			<RouterHost>{children}</RouterHost>
		</StrictMode>
	);
}
