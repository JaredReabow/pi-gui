import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const pidFile = process.argv[2];
if (!pidFile) {
  process.stderr.write("A PID evidence path is required.\n");
  process.exit(2);
}

const ignoreTermination = () => {};
process.on("SIGTERM", ignoreTermination);

const descendantSource = `
  process.on("SIGTERM", () => {});
  process.stdout.write("owned descendant ready\\n");
  setInterval(() => {}, 1000);
`;
const descendant = spawn(process.execPath, ["-e", descendantSource], {
  stdio: ["ignore", "inherit", "inherit"],
});

writeFileSync(
  pidFile,
  `${JSON.stringify(
    {
      rootPid: process.pid,
      descendantPid: descendant.pid,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(`owned root ${process.pid}, descendant ${descendant.pid}\n`);
setInterval(() => {}, 1000);
