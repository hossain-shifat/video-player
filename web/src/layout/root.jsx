import React from "react";
import { Outlet } from "react-router";
import Navbar from "../components/navbar";

const root = () => {
    return (
        <div>
            <Navbar />
            <div className="w-full h-screen bg-base-200">
                <Outlet />
            </div>
        </div>
    );
};

export default root;
