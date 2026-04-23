import { createApp, startServer } from "./app";

const app = createApp();

export function bootServer(
  currentRequire: NodeJS.Require = require,
  currentModule: NodeJS.Module = module,
) {
  if (currentRequire.main === currentModule) {
    startServer(app);
  }

  return app;
}

bootServer();

export default app;
