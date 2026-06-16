/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK + agent ship as raw TypeScript in the monorepo; transpile them here.
  transpilePackages: ["@linepay/sdk", "@linepay/agent"],
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Allow importing the workspace SDK/agent source directly.
    externalDir: true,
  },
  webpack: (config) => {
    // We use ESM-style `.js` import specifiers that actually point at `.ts`
    // source files (NodeNext convention). Teach webpack to try `.ts`/`.tsx`
    // when a `./foo.js` specifier is requested so the raw-TS packages resolve.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    // @metamask/sdk optionally imports React Native AsyncStorage; it's not used
    // in the browser build. Alias it away to silence the "module not found"
    // warning from WalletConnect's optional deps.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
