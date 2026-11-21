// app/legwork-tokens.css is generated for the design package, so its
// @font-face rules point at docs/design/06-assets/fonts by a path that only
// works there. The web app loads the same Inter files with next/font/local
// (app/layout.tsx), so those rules are dropped here rather than edited by hand.
const plugin = () => ({
  postcssPlugin: "legwork-design-fonts",
  AtRule: {
    "font-face": (rule) => {
      if (rule.toString().includes("06-assets/fonts/")) rule.remove();
    },
  },
});
plugin.postcss = true;

export default plugin;
