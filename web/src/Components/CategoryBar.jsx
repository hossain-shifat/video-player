import { Link, NavLink } from "react-router";
import { useApi } from "../Context/apiContext";
import { ChevronRight } from "lucide-react";

const CategoryBar = ({ onSelect }) => {
    const { categories, loading } = useApi();

    return (
        <div className="w-full">
            {/* Heading — block so full row is clickable */}
            <NavLink to="/category/all" className="flex items-center gap-1 mb-0.5 w-fit group">
                <h2 className="text-base sm:text-lg font-semibold text-white group-hover:text-primary transition-colors duration-150">Browse Movies &amp; TV Shows</h2>
                <ChevronRight size={18} className="text-base-content group-hover:text-primary transition-colors duration-150 shrink-0" />
            </NavLink>
            <p className="text-xs text-base-content/40 mb-3">On Demand</p>

            <div className="flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2 w-full" style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}>
                {loading.categories
                    ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 w-20 sm:w-24 rounded-full bg-base-300 animate-pulse shrink-0" />)
                    : categories.map((cat) => (
                          <Link
                              key={cat.name}
                              to={`/category/${encodeURIComponent(cat.name.toLowerCase())}`}
                              className={[
                                  "shrink-0 grow-0 whitespace-nowrap select-none no-underline",
                                  "px-4 py-1.5 sm:px-5 sm:py-2 rounded-full text-xs sm:text-sm font-medium",
                                  "border border-base-content/10 text-base-content/60",
                                  "bg-base-200/60 hover:bg-base-content/8 hover:text-base-content hover:border-base-content/25",
                                  "transition-all duration-150",
                              ].join(" ")}>
                              {cat.name}
                          </Link>
                      ))}
            </div>
        </div>
    );
};

export default CategoryBar;
