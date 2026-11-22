import { spawn } from "node:child_process";

const args = process.argv.slice(2);
let port = "8787";

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--host" && args[index + 1]) {
    index += 1;
  } else if (args[index] === "--port" && args[index + 1]) {
    port = args[index + 1];
    index += 1;
  }
}

const wrangler = process.platform === "win32"
  ? "node_modules/.bin/wrangler.cmd"
  : "node_modules/.bin/wrangler";

const child = spawn(
  wrangler,
  ["dev", "--local", "--ip", "127.0.0.1", "--port", port, "--persist-to", ".wrangler/state"],
  { stdio: "inherit" }
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
