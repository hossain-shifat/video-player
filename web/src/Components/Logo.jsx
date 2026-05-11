import React from "react";
import { NavLink } from "react-router";

const Logo = () => {
    return (
        <NavLink to="/">
            <h1 className="text-primary font-black text-[1.62rem] md:text-3xl font-ibm-plex-sans">
                F<span className="text-xl md:text-2xl lowercase">LU</span>X
            </h1>
        </NavLink>
    );
};

export default Logo;
