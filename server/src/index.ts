import { createApp, startServer } from "./app";

const app = createApp();

export function bootServer(
  currentRequire: NodeRequire = require,
  currentModule: NodeModule = module,
) {
  if (currentRequire.main === currentModule) {
    startServer(app);
  }

  return app;
}

bootServer();

export default app;
