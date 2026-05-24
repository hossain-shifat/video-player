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
import Player from "../Pages/Player/Player";
import TermsPage from "../Pages/Terms/TermsPage";
import PrivacyPage from "../Pages/Privacy/PrivacyPage";
import LicensesPage from "../Pages/Licenses/LicensesPage";

export const router = createBrowserRouter([
    {
        path: "/player/:id",
        Component: Player,
    },
    {
        path: "/",
        Component: Root,
        children: [
            {
                index: true,
                Component: Home,
            },
            {
                path: "category/all",
                Component: AllCategory,
            },
            {
                path: "category/:name",
                Component: CategoryPage,
            },
            {
                path: "media/:id",
                Component: MediaDetails,
            },
            {
                path: "movies",
                Component: Movies,
            },
            {
                path: "series",
                Component: Series,
            },
            {
                path: "settings",
                Component: Settings,
            },
            {
                path: "watchlist",
                Component: WatchList,
            },
            {
                path: "terms",
                Component: TermsPage,
            },
            {
                path: "privacy",
                Component: PrivacyPage,
            },
            {
                path: "licenses",
                Component: LicensesPage,
            },
        ],
    },
]);
