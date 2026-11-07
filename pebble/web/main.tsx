import { createRoot } from "react-dom/client";
import { BedrockProvider } from "bedrock/react";
import { client } from "./client";
import { App } from "./App";
import "@bedrock/ui/styles.css";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <BedrockProvider client={client}>
    <App />
  </BedrockProvider>,
);
