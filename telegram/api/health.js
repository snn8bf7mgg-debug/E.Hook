import { createLazyVercelRouteHandler, createVercelRouteHandler } from "../src/vercel-handler.js";

export const createHealthHandler = (options) => createVercelRouteHandler("health", options);

// Vercel invokes this request handler; it does not call the local startServer/listen path.
export default createLazyVercelRouteHandler("health");
