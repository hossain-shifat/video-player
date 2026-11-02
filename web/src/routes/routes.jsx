import { createBrowserRouter } from "react-router";
import Root from "../Layout/Root";
import Home from "../Pages/Home/Home";
import AllCategory from "../Pages/Category/AllCategory";
import CategoryPage from "../Pages/Category/CategoryPage";
import MediaDetails from "../Pages/Media/Details/MediaDetails";
import PersonPage from "../Pages/Person/PersonPage";
import DiscoverPage from "../Pages/Discover/DiscoverPage";
import Movies from "../Pages/Media/Movies/Movies";
import Series from "../Pages/Media/Series/Series";
import PlayerPage from "../Pages/Player/PlayerPage";
import Settings from "../Pages/Settings/Settings";
import WatchList from "../Pages/WatchList/WatchList";
import WatchTime from "../Pages/WatchTime/WatchTime";
import RecommendationsPage from "../Pages/Recommendations/RecommendationsPage";
// import Player from "../Pages/Player/Player";
import TermsPage from "../Pages/Terms/TermsPage";
import PrivacyPage from "../Pages/Privacy/PrivacyPage";
import LicensesPage from "../Pages/Licenses/LicensesPage";
import OAuthCallbackPage from "../Pages/Auth/OAuthCallbackPage";
import LoginPage from "../Pages/Auth/LoginPage";
import RegisterPage from "../Pages/Auth/RegisterPage";
import VerifyEmailPage from "../Pages/Auth/VerifyEmailPage";
import ForgotPasswordPage from "../Pages/Auth/ForgotPasswordPage";
import PendingPage from "../Pages/Auth/PendingPage";
import ExpiredPage, { AccessDeniedPage } from "../Pages/Auth/ExpiredPage";
import AuthLayout from "../Layout/AuthLayout";
import AuthGate from "../auth/AuthGate";
import PlaybackGate from "../auth/PlaybackGate";
import GuestOnly from "../auth/GuestOnly";
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
import DashStorage from "../dashboard/pages/DashStorage";
import DashIPTV from "../dashboard/pages/DashIPTV";
import DashAnnouncements from "../dashboard/pages/DashAnnouncements";
import ErrorPreview from "../Errors/ErrorPreview";
import ErrorShowcase from "../Errors/ErrorShowcase";
// import Live from "../Pages/Media/Live/Live";
import LivePlayerPage from "../Pages/Player/LivePlayerPage";
import Live from "../Pages/Live/Live";
import LiveCategory from "../Pages/Live/LiveCategory";

export const router = createBrowserRouter([
    // ─── Authentication — full pages on their own layout (no Navbar / Footer) ─────────────────
    // /login and /register bounce signed-in users away (GuestOnly). /verify-email, /pending and
    // /access-* need a session but NOT an approved/verified one, so they are not behind AuthGate.
    {
        Component: AuthLayout,
        children: [
            { Component: GuestOnly, children: [
                { path: "/login", Component: LoginPage },
                { path: "/register", Component: RegisterPage },
                { path: "/forgot-password", Component: ForgotPasswordPage },
            ] },
            { path: "/verify-email", Component: VerifyEmailPage },
            { path: "/pending", Component: PendingPage }, // optional status page — pending users are NOT forced here
            { path: "/access-expired", Component: ExpiredPage },
            { path: "/access-denied", Component: AccessDeniedPage },
            { path: "/auth/callback", Component: OAuthCallbackPage },
        ],
    },

    // ─── Playback routes — verified AND approved (PlaybackGate shows the approval modal otherwise) ───
    {
        Component: PlaybackGate,
        children: [
            { path: "/player/:id", Component: PlayerPage },
            // Live player — simple dedicated page, no main layout
            { path: "/live/watch/:id", Component: LivePlayerPage, errorElement: <Error500 /> },
        ],
    },

    // ─── Admin Dashboard (server enforces admin on every API call; this keeps unverified users out) ───
    {
        Component: AuthGate,
        children: [
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
                    { path: "iptv", Component: DashIPTV },
                    { path: "media", Component: DashMedia },
                    { path: "jobs", Component: DashJobs },
                    { path: "uploads", Component: DashUploads },
                    { path: "storage", Component: DashStorage },
                    { path: "announcements", Component: DashAnnouncements },
                ],
            },
        ],
    },

    // ─── Main app ────────────────────────────────────────────────────────────────────────────
    // Browsing needs a signed-in, VERIFIED account — not administrator approval. Verified pending
    // users see Home, Movies, Series, Live listings, Discover, details pages, search…
    {
        path: "/",
        Component: Root,
        children: [
            {
                Component: AuthGate,
                children: [
                    { index: true, Component: Home },
                    { path: "category/all", Component: AllCategory },
                    { path: "category/:name", Component: CategoryPage },
                    { path: "media/:id", Component: MediaDetails },
                    { path: "person/:personId", Component: PersonPage },
                    { path: "discover", Component: DiscoverPage },
                    { path: "live", Component: Live },
                    { path: "live/category/:slug", Component: LiveCategory },
                    { path: "movies", Component: Movies },
                    { path: "series", Component: Series },
                    { path: "settings", Component: Settings },
                    { path: "watchlist", Component: WatchList },
                    { path: "my-activity", Component: WatchTime },
                    { path: "recommendations", Component: RecommendationsPage },
                    { path: "my-media", Component: MyMedia },
                ],
            },
            // legal pages stay public (linked from the sign-up form)
            { path: "terms", Component: TermsPage },
            { path: "privacy", Component: PrivacyPage },
            { path: "licenses", Component: LicensesPage },
        ],
    },

    ...(import.meta.env.DEV
        ? [
              {
                  path: "/dev/errors",
                  Component: ErrorShowcase,
              },
              {
                  path: "/dev/errors/:code",
                  Component: ErrorPreview,
              },
          ]
        : []),

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
