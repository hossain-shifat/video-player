// Dashboard/Shared.js
// The ONLY file in Dashboard/ that reaches outside it. Everything else in Dashboard/ imports
// shared things from here, so the boundary is one place. Nothing outside Dashboard/ may import
// Dashboard files (except Routes/Routes.jsx, which mounts the pages).
export * from "../Api/client";
export * from "../Api/live";
export * from "../Api/notifications";
export { useAuth } from "../Auth/AuthContext";
export { default as Logo } from "../Components/Layout/Logo";
