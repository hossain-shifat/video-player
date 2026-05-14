import { createBrowserRouter } from "react-router";
import Root from "../Layout/Root";
import Home from "../Pages/Home/Home";
import AllCategory from "../Pages/Category/AllCategory";
import CategoryPage from "../Pages/Category/CategoryPage";
import MediaDetails from "../Pages/Media/Details/MediaDetails";

export const router = createBrowserRouter([
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
            // {
            //     path: "live",
            //     Component: LiveTV,
            // },
            // {
            //     path: "movies",
            //     Component: Movies,
            // },
            // {
            //     path: "series",
            //     Component: Series,
            // },
            // {
            //     path: "library",
            //     Component: Library,
            // },
            // {
            //     path: "profile",
            //     Component: Profile,
            // },
            // {
            //     path: "friends",
            //     Component: Friends,
            // },
            // {
            //     path: "watchlist",
            //     Component: Watchlist,
            // },
            // {
            //     path: "media",
            //     Component: Media,
            // },
            // {
            //     path: "folders",
            //     Component: Folders,
            // },
            // {
            //     path: "services",
            //     Component: Services,
            // },
            // {
            //     path: "privacy",
            //     Component: Privacy,
            // },
            // {
            //     path: "settings",
            //     Component: SettingsPage,
            // },
        ],
    },
]);
