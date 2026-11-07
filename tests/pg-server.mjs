// Standalone real-PostgreSQL server for the tests. Run as a NON-root user (Postgres refuses root):
//   runuser -u postgres -- node pg-server.mjs <port>      (needs node_modules reachable by that user)
// Prints READY when it accepts connections and stops on SIGTERM.
import EmbeddedPostgres from "embedded-postgres";
const port = Number(process.argv[2] || 54329);
const s = new EmbeddedPostgres({ databaseDir: `/tmp/pgsrv-${port}`, user: "postgres", password: "pw", port, persistent: false, onLog: () => {}, onError: () => {} });
await s.initialise(); await s.start(); console.log("READY " + port);
const stop = async () => { await s.stop(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
setInterval(() => {}, 1 << 30);
