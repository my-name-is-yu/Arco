import "./styles.css";
import "./zod-config";
import { createRoot } from "react-dom/client";
import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { App } from "./App";
import { connectHost } from "./host";
import { WorkspaceSkeleton } from "./LoadingSkeleton";

const root = createRoot(document.getElementById("root")!);
root.render(<WorkspaceSkeleton />);
connectHost()
  .then((host) => {
    root.render(
      <AppsSDKUIProvider linkComponent="a">
        <App host={host} />
      </AppsSDKUIProvider>,
    );
  })
  .catch(() => {
    root.render(
      <main role="alert">
        Open Arco in Codex. For browser testing, follow the local fixture
        instructions in the README.
      </main>,
    );
  });
