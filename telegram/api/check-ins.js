import { createLazyVercelRouteHandler, createVercelRouteHandler } from "../src/vercel-handler.js";

export const createCheckInsHandler = (options) => createVercelRouteHandler("check-ins", options);

// Vercel invokes this request handler; it does not call the local startServer/listen path.
export default createLazyVercelRouteHandler("check-ins");
