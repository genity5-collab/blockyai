import React from "react"; import { createRoot } from "react-dom/client";
import "./fonts.css"; import "./styles.css"; import "./ui.css"; import App from "./App.jsx"; import { AppProvider } from "./lib/store.jsx";
createRoot(document.getElementById("root")).render(<AppProvider><App /></AppProvider>);
