import { useState } from "react";
import { Link, NavLink } from "react-router";
import { useApi } from "../Context/apiContext";
import { ChevronRight } from "lucide-react";

const CategoryBar = ({ onSelect }) => {
    const { categories, loading } = useApi();
    const [active, setActive] = useState(null);

    return (
        <div className="w-full">
            <NavLink to="/category/all" className="flex items-center gap-1.5 mb-0.5">
                <h2 className="text-base sm:text-lg font-medium text-white">Browse Movies & TV Shows</h2>
                <span className="text-gray-400 text-base sm:text-lg">
                    <ChevronRight />
                </span>
            </NavLink>
            <p className="text-xs text-gray-500 mb-3">On Demand</p>

            <div
                className="flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2 w-full"
                style={{
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                    WebkitOverflowScrolling: "touch",
                }}>
                {loading.categories
                    ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 w-20 sm:w-24 rounded-full bg-gray-700 animate-pulse shrink-0" />)
                    : categories.map((cat) => (
                          <Link
                              key={cat.name}
                              to={`/category/${encodeURIComponent(cat.name.toLowerCase())}`}
                              className={[
                                  "shrink-0 grow-0",
                                  "whitespace-nowrap",
                                  "px-4 py-1.5 sm:px-5 sm:py-2",
                                  "rounded-full text-xs sm:text-sm",
                                  "border border-gray-700 text-gray-300",
                                  "bg-gray-900/40 hover:bg-gray-800/60 hover:text-white",
                                  "transition-colors duration-150",
                                  "select-none no-underline",
                              ].join(" ")}>
                              {cat.name}
                          </Link>
                      ))}
            </div>
        </div>
    );
};

export default CategoryBar;
