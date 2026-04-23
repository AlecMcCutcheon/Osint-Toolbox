import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: process.env.DOTENV_PATH || resolve(__dirname, "..", ".env") });
