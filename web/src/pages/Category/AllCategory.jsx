import React from "react";
import { useApi } from "../../Context/apiContext";
import CategoryCard from "../../Components/CategoryCards";

const AllCategory = () => {
    const { categories, loading } = useApi();
    const { categories, loading, errors } = useApi();

    if (errors.categories) {
        return (
            <div className="text-center py-12">
                <p className="text-red-400">Failed to load categories</p>
            </div>
        );
    }

    return (
        <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {loading.categories
                    ? Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-video rounded-xl bg-gray-700 animate-pulse" />)
                    : categories.map((cat) => <CategoryCard key={cat.name} name={cat.name} />)}
            </div>
        </div>
    );
};

export default AllCategory;
