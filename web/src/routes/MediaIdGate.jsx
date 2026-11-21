// web/src/Routes/MediaIdGate.jsx
import { useParams } from "react-router";
import { MediaRouteIdContext, useResolveMediaId } from "../Hooks/Query/useMediaRouteId";
import Error404 from "../Errors/Error404";

/**
 * Wraps a page mounted on a route with an :id param. Short aliases are resolved to the long media id first
 * (instantly when the app built the link, otherwise via GET /api/ids/:alias); the page then renders as before.
 */
export function withResolvedMediaId(Page, Fallback = null) {
    function ResolvedMediaRoute(props) {
        const { id: param } = useParams();
        const { id, pending, notFound } = useResolveMediaId(param);
        if (notFound) return <Error404 />;
        if (pending) return Fallback ? <Fallback /> : null;
        return (
            <MediaRouteIdContext.Provider value={id}>
                <Page {...props} />
            </MediaRouteIdContext.Provider>
        );
    }
    ResolvedMediaRoute.displayName = `ResolvedMediaId(${Page.displayName || Page.name || "Page"})`;
    return ResolvedMediaRoute;
}
