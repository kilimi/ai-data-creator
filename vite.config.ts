import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from 'fs';

// Serve onnxruntime-web WASM and .mjs/.js from node_modules so workers can load them
const ONNX_DIST = path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');
const wasmPlugin = () => ({
  name: 'wasm-mime-type',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      const urlPath = req.url?.split('?')[0] || '';
      if (!urlPath.startsWith('/wasm/')) {
        next();
        return;
      }
      const name = path.basename(urlPath);
      const filePath = path.join(ONNX_DIST, name);
      if (!fs.existsSync(filePath)) {
        next();
        return;
      }
      try {
        const ext = path.extname(name).toLowerCase();
        const mime = ext === '.wasm' ? 'application/wasm' : 'application/javascript';
        const body = fs.readFileSync(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', String(body.length));
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.end(body);
        return;
      } catch (e) {
        next();
      }
    });
  },
  buildStart() {},
});

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const { componentTagger } = await import("lovable-tagger");
  
  return {
    server: {
      host: "::",
      port: 8080,
      fs: {
        // Allow serving files from one level up to the project root
        allow: ['..'],
      },
      // Configure MIME types for WASM files
      mimeTypes: {
        'application/wasm': ['wasm'],
      },
    },
    // Configure public directory for static assets
    publicDir: 'public',
    plugins: [
      react(),
      wasmPlugin(),
      mode === 'development' &&
      componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      // Avoid duplicate React; splitting @radix-ui into its own chunk caused runtime
      // "Cannot read properties of undefined (reading 'forwardRef')" in production builds.
      dedupe: ["react", "react-dom"],
    },
    build: {
      chunkSizeWarningLimit: 1700,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes("node_modules/onnxruntime-web")) return "onnx";
            if (id.includes("node_modules/jszip")) return "jszip";
            // One vendor chunk for all other node_modules so React is never undefined in
            // auto-split shared chunks (e.g. ui-*.js) — fixes forwardRef runtime errors.
            if (id.includes("node_modules/")) return "vendor";
          },
          // Ensure WASM files are treated as assets
          assetFileNames: (assetInfo: any) => {
            if (assetInfo.name?.endsWith('.wasm')) {
              return 'wasm/[name][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["tests/**", "node_modules/**", "dist/**"],
    },
  };
});
