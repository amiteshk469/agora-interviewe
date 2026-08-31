import { readFileSync } from "node:fs";

import { parseEnvFile, validateProductionEnvironment } from "./index.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: validate-production-env.ts <env-file>");
validateProductionEnvironment(parseEnvFile(readFileSync(path, "utf8")));
console.log("Production environment contract is valid");
