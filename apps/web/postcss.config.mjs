import { fileURLToPath } from "node:url";

// PostCSS resolves plugins by name from Next's own build folder, so the local
// plugin is passed by absolute path.
const designFonts = fileURLToPath(new URL("./postcss-design-fonts.mjs", import.meta.url));

export default {
  plugins: {
    "@tailwindcss/postcss": {},
    [designFonts]: {},
  },
};
