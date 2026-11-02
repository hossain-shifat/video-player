import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RouterProvider } from "react-router";
import { router } from "./Routes/Routes.jsx";
import { ThemeProvider } from "./Context/themeContext.jsx";
import { ApiProvider } from "./Context/apiContext.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { AuthModalProvider } from "./auth/AuthModalContext.jsx";
import { QueryProvider } from "./providers/QueryProvider.jsx";
import { listenToServiceWorker } from "./utils/push.js";

// Clicking a system (push) notification while FLUX is already open: route inside the SPA —
// no reload, so playback isn't interrupted. The bell opens the details modal for ?n=<id>.
listenToServiceWorker({ onOpen: (id) => router.navigate(id ? `/?n=${encodeURIComponent(id)}` : "/") });

// Sign-in / registration / verification are full pages now (/login, /register, /verify-email).
// AuthModalProvider is a thin shim so existing openAuthModal() callers navigate to those pages.
function AppWithModal() {
    return (
        <AuthModalProvider navigate={(to, opts) => router.navigate(to, opts)}>
            <ApiProvider>
                <RouterProvider router={router} />
            </ApiProvider>
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
