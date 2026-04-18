import { defineConfig } from "astro/config";
import tailwind from "@tailwindcss/vite";

// Deploys to GitHub Pages under the custom domain claude.ldlework.com
// (see site/public/CNAME).
export default defineConfig({
  site: "https://claude.ldlework.com",
  vite: {
    plugins: [tailwind()],
  },
});
