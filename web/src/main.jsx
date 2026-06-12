import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RouterProvider } from "react-router";
import { router } from "./Routes/Routes.jsx";
import { ThemeProvider } from "./Context/themeContext.jsx";
import { ApiProvider } from "./Context/apiContext.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { AuthModalProvider } from "./auth/AuthModalContext.jsx";
import AuthModal from "./Components/auth/AuthModal.jsx";
import { QueryProvider } from "./providers/QueryProvider.jsx";

function AppWithModal() {
    return (
        <AuthModalProvider>
            <ApiProvider>
                <RouterProvider router={router} />
            </ApiProvider>
            {/* Auth modal mounted at root — visible globally */}
            <AuthModal />
        </AuthModalProvider>
    );
}

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <QueryProvider>
            <ThemeProvider>
                <AuthProvider>
                    <AppWithModal />
                </AuthProvider>
            </ThemeProvider>
        </QueryProvider>
    </StrictMode>,
);
