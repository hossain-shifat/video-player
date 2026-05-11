import React from "react";
import { Outlet } from "react-router";
import Navbar from "../Components/Navbar";

const Root = () => {
    return (
        <div className="w-full overflow-x-hidden">
            <Navbar />
            <div className="w-full min-h-screen bg-base-100 p-4 sm:p-6 lg:p-8">
                <Outlet />
            </div>
        </div>
    );
};

export default Root;
