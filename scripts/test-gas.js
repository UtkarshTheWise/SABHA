// `REPORT_GAS=true hardhat test` is Unix shell syntax and fails in PowerShell,
// so set the variable from Node instead. Works the same on every platform.
const { spawnSync } = require("child_process");

const result = spawnSync("npx", ["hardhat", "test"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, REPORT_GAS: "true" },
});
process.exit(result.status ?? 1);
