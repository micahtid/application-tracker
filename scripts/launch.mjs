/**
 * The four steps that start the app, for every system.
 *
 * In Node rather than in a shell script so there is one copy of them.
 * `start.bat` calls in here, and everything else runs it directly.
 *
 *   npm run launch
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// The server has no login, so it binds to 127.0.0.1 and nothing else. Moving
// off this port means changing the `dev` and `start` scripts and the Google
// redirect URI with it.
const url = "http://127.0.0.1:3939";

/** Runs a step, and stops here if it fails. */
function run(command, args) {
  // shell: true, or npm and npx are not found on Windows, where both are batch
  // files rather than programs.
  const { status } = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: true });
  if (status !== 0) {
    console.error("\nSomething went wrong. The message above says what.");
    process.exit(status ?? 1);
  }
}

/** Opens the board, or carries on quietly when the system has no opener. */
function openBrowser() {
  // One string rather than a command and its arguments, because cmd's `start`
  // reads a lone quoted argument as the window title.
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  spawnSync(command, { cwd: root, stdio: "ignore", shell: true });
}

if (!existsSync(join(root, "node_modules"))) {
  console.log("Installing dependencies, this happens once...");
  run("npm", ["install"]);
}

console.log("Applying any new database migrations...");
run("npx", ["prisma", "migrate", "deploy"]);

if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  console.log("Building the app, this happens once...");
  run("npm", ["run", "build"]);
}

openBrowser();
console.log(`Serving at ${url}`);
run("npm", ["run", "start"]);
