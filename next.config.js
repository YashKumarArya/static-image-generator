/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: isProd ? "/static-image-generator" : "",
  assetPrefix: isProd ? "/static-image-generator/" : "",
};

module.exports = nextConfig;
