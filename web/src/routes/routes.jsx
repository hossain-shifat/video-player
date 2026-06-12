import { createBrowserRouter } from "react-router";
import Root from "../Layout/Root";
import Home from "../Pages/Home/Home";
import AllCategory from "../Pages/Category/AllCategory";
import CategoryPage from "../Pages/Category/CategoryPage";
import MediaDetails from "../Pages/Media/Details/MediaDetails";
import Movies from "../Pages/Media/Movies/Movies";
import Series from "../Pages/Media/Series/Series";
import PlayerPage from "../Pages/Player/PlayerPage";
import Settings from "../Pages/Settings/Settings";
import WatchList from "../Pages/WatchList/WatchList";
// import Player from "../Pages/Player/Player";
import TermsPage from "../Pages/Terms/TermsPage";
import PrivacyPage from "../Pages/Privacy/PrivacyPage";
import LicensesPage from "../Pages/Licenses/LicensesPage";
import OAuthCallbackPage from "../Pages/Auth/OAuthCallbackPage";
import MyLibrary from "../Pages/Library/MyLibrary";
import MyMedia from "../Pages/Media/MyMedia/MyMedia";

// ─── Error Pages ────────────────────────────────────────────────────────────
import ErrorLayout from "../Layout/ErrorLayout";
import { Error401, Error403, Error404, Error429, Error500, ErrorTimeout, ErrorNetwork } from "../Errors";

// ── Admin Dashboard (lazy for code splitting) ──────────────────────────────
import DashboardLayout from "../dashboard/DashboardLayout";
import DashOverview from "../dashboard/pages/DashOverview";
import DashUsers from "../dashboard/pages/DashUsers";
import DashStreams from "../dashboard/pages/DashStreams";
import DashHealth from "../dashboard/pages/DashHealth";
import DashLogs from "../dashboard/pages/DashLogs";
import DashLibraries from "../dashboard/pages/DashLibraries";
import DashMedia from "../dashboard/pages/DashMedia";
import DashJobs from "../dashboard/pages/DashJobs";
import DashUploads from "../dashboard/pages/DashUploads";

export const router = createBrowserRouter([
    {
        path: "/player/:id",
        Component: PlayerPage,
    },

    // ─── OAuth callback (only dedicated auth route needed) ────────────────────
    {
        path: "/auth/callback",
        Component: OAuthCallbackPage,
    },

    // ─── Admin Dashboard ────────────────────────────────────────────────────────
    {
        path: "/dashboard",
        Component: DashboardLayout,
        children: [
            { index: true, Component: DashOverview },
            { path: "users", Component: DashUsers },
            { path: "streams", Component: DashStreams },
            { path: "health", Component: DashHealth },
            { path: "logs", Component: DashLogs },
            { path: "libraries", Component: DashLibraries },
            { path: "media", Component: DashMedia },
            { path: "jobs", Component: DashJobs },
            { path: "uploads", Component: DashUploads },
        ],
    },

    // ─── Main app — PUBLIC. Auth is progressive via modal. ───────────────────
    {
        path: "/",
        Component: Root,
        children: [
            { index: true, Component: Home },
            { path: "category/all", Component: AllCategory },
            { path: "category/:name", Component: CategoryPage },
            { path: "media/:id", Component: MediaDetails },
            { path: "movies", Component: Movies },
            { path: "series", Component: Series },
            { path: "settings", Component: Settings },
            { path: "watchlist", Component: WatchList },
            { path: "library", Component: MyLibrary },
            { path: "my-media", Component: MyMedia },
            { path: "terms", Component: TermsPage },
            { path: "privacy", Component: PrivacyPage },
            { path: "licenses", Component: LicensesPage },
        ],
    },

    // ─── Error System ──────────────────────────────────────────────────────────
    {
        Component: ErrorLayout,
        children: [
            { path: "401", Component: Error401 },
            { path: "403", Component: Error403 },
            { path: "404", Component: Error404 },
            { path: "429", Component: Error429 },
            { path: "500", Component: Error500 },
            { path: "timeout", Component: ErrorTimeout },
            { path: "network", Component: ErrorNetwork },
            { path: "*", Component: Error404 }, // Catch-all inside ErrorLayout defaults to 404
        ],
    },
]);
