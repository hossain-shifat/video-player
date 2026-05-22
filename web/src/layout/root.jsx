import React from "react";
import { Outlet } from "react-router";
import Navbar from "../Components/Navbar";
import Footer from "../Components/Footer";

const Root = () => {
    return (
        <div className="min-h-screen">
            <Navbar />
            <main className="w-full bg-base-100 p-4 sm:p-6 lg:p-8 mb-5">
                <Outlet />
            </main>
            <Footer />
        </div>
    );
};

export default Root;
