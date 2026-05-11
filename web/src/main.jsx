import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { RouterProvider } from "react-router";
import { router } from "./Routes/Routes.jsx";
import { ThemeProvider } from "./Context/themeContext.jsx";
import { ApiProvider } from "./Context/apiContext.jsx";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <ThemeProvider>
            <ApiProvider>
                <RouterProvider router={router} />
            </ApiProvider>
        </ThemeProvider>
    </StrictMode>,
);
