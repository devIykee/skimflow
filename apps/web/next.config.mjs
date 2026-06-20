/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK + agent ship as raw TypeScript in the monorepo; transpile them here.
  transpilePackages: ["@skimflow/sdk", "@skimflow/agent"],
  // Keep the Postgres driver out of the bundler (Node runtime resolves it).
  serverExternalPackages: ["pg"],
  experimental: {
    // Allow importing the workspace SDK/agent source directly.
    externalDir: true,
  },
  // Dot-folders aren't routable in app/, so expose the agent discovery doc via
  // a rewrite to a normal API route.
  async rewrites() {
    return [
      { source: "/.well-known/agent-payment.json", destination: "/api/well-known/agent-payment" },
    ];
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
