import React from "react";
import { Outlet } from "react-router";
import Navbar from "../Components/Navbar";

const Root = () => {
    return (
        <div>
            <Navbar />
            <div className="h-[200vh] bg-base-100">
                <Outlet />
            </div>
        </div>
    );
};

export default Root;
