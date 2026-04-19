import { createApp, startServer } from "./app";

const app = createApp();

if (require.main === module) {
  startServer(app);
}

export default app;
