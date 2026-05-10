import React from "react";
import { Outlet } from "react-router";

const root = () => {
    return (
        <div className="bg-red-500">
            <Outlet />
        </div>
    );
};

export default root;
