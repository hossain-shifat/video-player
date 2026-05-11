import React from "react";
import { Outlet } from "react-router";
import Navbar from "../Components/Navbar";

const Root = () => {
    return (
        <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1 w-full bg-base-100 p-4 sm:p-6 lg:p-8">
                <Outlet />
            </main>
        </div>
    );
};

export default Root;
