import React, { useEffect } from "react";
import { useApi } from "../../Context/apiContext";
import CategoryBar from "../../Components/CategoryBar";

const Home = () => {
    const { media, categories, fetchMedia, loading, errors } = useApi();
    console.log(categories);
    if (loading.media) return <div>Loading...</div>;
    if (loading.categories) return <div>Loading...</div>;

    return (
        <div>
            <CategoryBar onSelect={(cat) => (cat ? fetchByCategory(cat) : null)} />
        </div>
    );
};

export default Home;
