import React from "react";
import { Link } from "react-router";

const Logo = () => {
    return (
        <Link to="/">
            <h1 className="text-primary font-black text-[1.62rem] md:text-3xl font-ibm-plex-sans">
                F<span className="text-xl md:text-2xl lowercase">LU</span>X
            </h1>
        </Link>
    );
};

export default Logo;
