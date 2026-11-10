import { build, preview } from 'vite';

await build({ base: '/sequence-metronome/' });
const server = await preview({
  base: '/sequence-metronome/',
  preview: { host: '127.0.0.1', port: 4188, strictPort: true },
});
const stop = () => {
  server.httpServer.closeAllConnections();
  server.httpServer.close(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
