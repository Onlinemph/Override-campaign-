import { defineConfig } from "vite";

// base: "./" makes all asset URLs relative, so the build works whether it is
// served from the domain root or from a GitHub Pages project subpath
// (https://<user>.github.io/<repo>/) without hard-coding the repo name.
export default defineConfig({
  base: "./",
  // Injected build timestamp, shown in the footer so it's obvious at a glance
  // whether the page is the latest deploy or a cached one.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
});
