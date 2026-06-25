import { Link } from "react-router";

import { Error401, Error403, Error404, Error429, Error500, ErrorNetwork, ErrorTimeout } from "./";

const errors = [
    { code: "401", title: "Unauthorized", component: <Error401 /> },
    { code: "403", title: "Forbidden", component: <Error403 /> },
    { code: "404", title: "Not Found", component: <Error404 /> },
    { code: "429", title: "Too Many Requests", component: <Error429 /> },
    { code: "500", title: "Internal Server Error", component: <Error500 /> },
    { code: "network", title: "Network Error", component: <ErrorNetwork /> },
    { code: "timeout", title: "Timeout", component: <ErrorTimeout /> },
];

export default function ErrorShowcase() {
    return (
        <div className="min-h-screen bg-background text-foreground p-8">
            <h1 className="text-4xl font-bold mb-2">Error Page Showcase</h1>

            <p className="text-muted-foreground mb-8">Preview every error page during development.</p>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {errors.map((error) => (
                    <Link key={error.code} to={`/dev/errors/${error.code}`} className="rounded-xl border p-6 hover:border-primary transition-all">
                        <h2 className="text-2xl font-semibold">{error.code}</h2>

                        <p className="text-muted-foreground">{error.title}</p>
                    </Link>
                ))}
            </div>
        </div>
    );
}
