import { createBrowserRouter } from "react-router";
import root from "../Layout/root";
import home from "../pages/home/home";

export const router = createBrowserRouter([
    {
        path: "/",
        Component: root,
        children: [
            {
                index: true,
                Component: home,
            },
        ],
    },
]);
