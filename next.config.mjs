import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      yjs: path.resolve(__dirname, "node_modules/yjs/dist/yjs.mjs"),
    };
    return config;
  },
};

export default nextConfig;
