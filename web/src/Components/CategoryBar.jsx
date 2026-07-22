import { Link, NavLink } from "react-router";
import { useApi } from "../Context/apiContext";
import { ChevronRight } from "lucide-react";

const CategoryBar = ({ onSelect }) => {
    const { categories, loading } = useApi();

    return (
        <div className="w-full">
            {/* Heading */}
            <NavLink to="/category/all" className="flex items-center gap-1 w-fit group">
                <h2 className="text-base sm:text-lg font-semibold text-base-content group-hover:text-primary transition-colors duration-150">Browse Movies &amp; TV Shows</h2>
                <ChevronRight size={16} className="text-base-content/50 group-hover:text-primary transition-colors duration-150 shrink-0" />
            </NavLink>
            <p className="text-xs text-base-content/35 mb-1.5">On Demand</p>

            {/* Capsule row */}
            <div className="relative">
                <div
                    className="flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pt-1 pb-2 w-full"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}>
                    {loading.categories
                        ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="shrink-0 h-8 w-20 sm:w-24 rounded-full border border-base-content/10 animate-pulse shadow-none" />)
                        : categories.map((cat) => (
                              <Link
                                  key={cat.name}
                                  to={`/category/${encodeURIComponent(cat.name.toLowerCase())}`}
                                  onClick={() => onSelect?.(cat.name)}
                                  className="group/cap relative shrink-0 grow-0 select-none no-underline
                                             flex items-center
                                             px-4 py-2 sm:px-3 sm:py-1
                                             rounded-full text-xs sm:text-sm font-semibold
                                             border border-base-content/10
                                             text-base-content/85
                                             bg-base-200/50
                                             shadow-none outline-none
                                             hover:border-primary/50 hover:text-primary hover:bg-primary/10
                                             transition-all duration-150">
                                  <span className="whitespace-nowrap">{cat.name}</span>
                              </Link>
                          ))}
                </div>
            </div>
        </div>
    );
};

export default CategoryBar;
