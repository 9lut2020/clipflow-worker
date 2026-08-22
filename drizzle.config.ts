import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

// ดึง DATABASE_URL ออกมาจากไฟล์ .dev.vars อัตโนมัติ
const devVarsPath = path.resolve(".dev.vars");
let dbUrl = "";
if (fs.existsSync(devVarsPath)) {
  const devVars = fs.readFileSync(devVarsPath, "utf8");
  dbUrl = devVars.match(/DATABASE_URL=(.*)/)?.[1] || "";
}

export default defineConfig({
  schema: "./packages/db/src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
