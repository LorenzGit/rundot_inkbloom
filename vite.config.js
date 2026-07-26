import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { rundotGameLibrariesPlugin, rundotGamePlaygroundPlugin } from "@series-inc/rundot-game-sdk/vite";

const playgroundEnabled = process.env.RUNDOT_PLAYGROUND === "1";

const plugins = [rundotGameLibrariesPlugin(), react(), tailwindcss()];

// Playground talks to real RUN services and requires sign-in, so it must never
// ambush ordinary local development. Purchases made there are real/persistent.
if (playgroundEnabled) plugins.push(rundotGamePlaygroundPlugin());

export default defineConfig({
    // REQUIRED for RUN: deployed builds are served from a subdirectory, so all
    // asset URLs must be relative. Do not change this.
    base: "./",
    plugins,
    server: {
        allowedHosts: true,
        port: 5184,
    },
    build: {
        // Top-level await in the RUN SDK needs a modern target.
        target: "es2022",
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                // Vendor code never changes between gameplay edits, so each
                // large dependency gets its own long-lived, separately cacheable
                // chunk. This also keeps the standalone build — where React and
                // the SDK's Firebase transitive are inlined rather than embedded
                // by the host — inside the per-chunk size budget.
                manualChunks(id) {
                    if (id.includes("node_modules/pixi.js")) return "pixi";
                    if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
                    if (id.includes("node_modules/@firebase") || id.includes("node_modules/firebase")) {
                        return "firebase";
                    }
                    return undefined;
                },
            },
        },
    },
    esbuild: { target: "es2022" },
    optimizeDeps: {
        esbuildOptions: {
            target: "es2022",
        },
    },
});
