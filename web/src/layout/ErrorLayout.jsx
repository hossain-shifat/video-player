// web/src/Layout/ErrorLayout.jsx
import { Outlet } from "react-router";

export default function ErrorLayout() {
    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4 font-sans text-base-content overflow-hidden">
            <main className="w-full max-w-4xl flex flex-col items-center justify-center relative">
                <Outlet />
            </main>
        </div>
    );
}
