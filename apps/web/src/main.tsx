import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/geist";
import "@fontsource-variable/newsreader";
import "./styles/app.css";

import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
