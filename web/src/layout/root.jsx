import React from "react";
import { Outlet } from "react-router";

const root = () => {
    return (
        <div className="bg-green-500">
            <Outlet />
        </div>
    );
};

export default root;
