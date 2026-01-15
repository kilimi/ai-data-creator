import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from 'fs';

// Plugin to ensure WASM files are served with correct MIME type
const wasmPlugin = () => ({
  name: 'wasm-mime-type',
  configureServer(server) {
    // Run FIRST in the middleware chain to catch WASM requests
    // Must run before Vite's static file middleware
    server.middlewares.use((req: any, res: any, next: any) => {
      // Log all requests for debugging
      if (req.url?.includes('.wasm')) {
        console.log('[WASM Plugin] Request detected:', req.url, 'Method:', req.method);
      }
      
      // Check for .wasm files in the URL
      if (req.url?.endsWith('.wasm') || req.url?.includes('.wasm')) {
        console.log('[WASM Plugin] Intercepting WASM request:', req.url, req.method);
        
        // Normalize the URL - remove query params if any
        const urlPath = req.url.split('?')[0];
        console.log('[WASM Plugin] Normalized path:', urlPath);
        
        // Try multiple possible paths
        const possiblePaths = [
          path.join(process.cwd(), 'public', urlPath), // /wasm/file.wasm -> public/wasm/file.wasm
          path.join(process.cwd(), 'public', 'wasm', path.basename(urlPath)), // Just the filename
          path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', path.basename(urlPath)), // From node_modules
        ];
        
        console.log('[WASM Plugin] Trying paths:', possiblePaths);
        
        let wasmPath: string | null = null;
        for (const testPath of possiblePaths) {
          if (fs.existsSync(testPath)) {
            wasmPath = testPath;
            console.log('[WASM Plugin] Found file at:', wasmPath);
            break;
          }
        }
        
        if (wasmPath) {
          console.log('[WASM Plugin] Serving WASM file from:', wasmPath);
          try {
            const fileContent = fs.readFileSync(wasmPath);
            console.log('[WASM Plugin] File size:', fileContent.length, 'bytes');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Content-Length', fileContent.length.toString());
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
            res.end(fileContent);
            console.log('[WASM Plugin] File served successfully');
            return; // Don't call next() - we've handled the request
          } catch (error) {
            console.error('[WASM Plugin] Error reading WASM file:', error);
          }
        } else {
          console.warn('[WASM Plugin] WASM file not found. Tried paths:', possiblePaths);
        }
      }
      next();
    });
  },
  // Also handle WASM files in the build
  buildStart() {
    console.log('[WASM Plugin] Build started - ensuring WASM files are included');
  },
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
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-slot'],
          },
          // Ensure WASM files are treated as assets
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.wasm')) {
              return 'wasm/[name][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
  };
});
