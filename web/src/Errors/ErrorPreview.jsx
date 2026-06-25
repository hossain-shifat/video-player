import { useParams } from "react-router";
import { Error401, Error403, Error404, Error429, Error500, ErrorNetwork, ErrorTimeout } from "./";

const pages = {
    401: Error401,
    403: Error403,
    404: Error404,
    429: Error429,
    500: Error500,
    network: ErrorNetwork,
    timeout: ErrorTimeout,
};

export default function ErrorPreview() {
    const { code } = useParams();

    const Component = pages[code] || Error404;

    return <Component />;
}
