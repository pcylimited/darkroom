import { defineConfig } from 'vite';
import os from 'node:os';

const PORT = 5183;
// IPv4 addresses of this machine, shown on the title screen so other devices can join
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => 'http://' + n.address + ':' + PORT);

export default defineConfig({
  // host: true binds every network interface, so the game is reachable by LAN IP
  server: { host: true, port: PORT, strictPort: true },
  preview: { host: true, port: PORT, strictPort: true },
  define: { __LAN_URLS__: JSON.stringify(lan) },
  build: { chunkSizeWarningLimit: 1200 },
});
