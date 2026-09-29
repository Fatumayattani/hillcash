import dotenv from "dotenv";

// npm workspaces start Next in packages/web; the template's example env lives at repo root.
dotenv.config({ path: "../../.env" });
export default { transpilePackages: ["@hillcash/agent"] };
