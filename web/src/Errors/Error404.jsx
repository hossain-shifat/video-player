// web/src/Errors/Error404.jsx
import ErrorCard from "./ErrorCard";
import { NotFoundIllustration } from "./ErrorIllustration";
import { Home } from "lucide-react";
import { useNavigate } from "react-router";

export default function Error404() {
    const navigate = useNavigate();
    return (
        <ErrorCard
            code="404"
            title="Lost in the Library"
            description="The page or media item you're looking for does not exist, has been moved, or is currently unavailable."
            illustration={NotFoundIllustration}
            primaryAction={() => navigate("/")}
            primaryLabel="Home Page"
            primaryIcon={Home}
        />
    );
}
