import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import { version } from "../../package.json"

// Configuration séparée de vite.config.ts : les tests n'ont besoin ni du
// générateur de routes, ni de Tailwind, ni du serveur de branding. Le JSX est
// transformé par esbuild plutôt que par le greffon React — le rafraîchissement
// à chaud n'a pas de sens ici, et c'est une pièce mobile de moins.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  // Le même remplacement qu'en production : sans lui, tout composant affichant
  // la version — le fond, donc chaque écran de saisie — lève au rendu.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@razzia/web": fileURLToPath(new URL("./src", import.meta.url)),
      "@razzia/common": fileURLToPath(
        new URL("../common/src", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
  },
})
