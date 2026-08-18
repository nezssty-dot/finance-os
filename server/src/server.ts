import { createApp } from "./app";
import { config } from "./config";
import { startScheduler } from "./integrations";

const app = createApp();
app.listen(config.port, () => {
  console.log(`\n  Finance OS API  →  http://localhost:${config.port}/api`);
  console.log(`  Web origin       →  ${config.webOrigin}\n`);
  // Un solo timer para toda la app. Chequea cada minuto qué integración toca.
  startScheduler();
});
