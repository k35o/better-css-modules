// Adversarial CSS collected while prototyping the check rules. The analyzer must
// accept every one of these without throwing and still find the right local
// classes; the check rules themselves are out of scope for the analyzer.
export const adversarialCss: { name: string; css: string; expected: string[] }[] = [
  {
    name: "relaxed nesting",
    css: `.a {\n  .b {\n    dispaly: flex;\n    color: #fff;\n  }\n}\n`,
    expected: ["a", "b"],
  },
  {
    name: "amp nesting",
    css: `.a {\n  & .b {\n    dispaly: flex;\n    color: #fff;\n  }\n}\n`,
    expected: ["a", "b"],
  },
  {
    name: "nested @media with plain selector",
    css: `.a {\n  @media (min-width: 800px) {\n    .b { color: #fff; }\n  }\n}\n`,
    expected: ["a", "b"],
  },
  {
    name: "nested @media, decl only",
    css: `.a {\n  @media (min-width: 800px) {\n    color: #fff;\n  }\n}\n`,
    expected: ["a"],
  },
  { name: "var fallback raw color", css: `.a { color: var(--fg-base, red); }`, expected: ["a"] },
  { name: "local custom prop", css: `.a { --c: #ff0000; color: var(--c); }`, expected: ["a"] },
  { name: "uppercase VAR", css: `.a { color: VAR(--radius-md); }`, expected: ["a"] },
  {
    name: "color-mix",
    css: `.a { color: color-mix(in oklch, var(--fg-base) 50%, white); }`,
    expected: ["a"],
  },
  {
    name: "media combos",
    css: `@media screen and (min-width: 800px) and (max-width: 1000px) { .a { color: var(--fg-base) } }`,
    expected: ["a"],
  },
  {
    name: "media reversed range",
    css: `@media (800px <= width) { .a { color: var(--fg-base) } }`,
    expected: ["a"],
  },
  {
    name: "media calc",
    css: `@media (width >= calc(48rem + 1px)) { .a { color: var(--fg-base) } }`,
    expected: ["a"],
  },
  {
    name: "container style query",
    css: `@container style(--x: 1) { .a { color: var(--fg-base) } }`,
    expected: ["a"],
  },
  {
    name: "media var",
    css: `@media (width >= var(--breakpoint-md)) { .a { color: var(--fg-base) } }`,
    expected: ["a"],
  },
  { name: "@import media", css: `@import url("x.css") (min-width: 800px);`, expected: [] },
  { name: "important", css: `.a { color: var(--fg-base) !important; }`, expected: ["a"] },
  {
    name: "vendor prefix",
    css: `.a { -webkit-line-clamp: 3; -webkit-box-orient: vertical; }`,
    expected: ["a"],
  },
  {
    name: "if()",
    css: `.a { width: if(media(width > 600px): 10px; else: 5px); }`,
    expected: ["a"],
  },
  { name: "attr type", css: `.a { width: attr(data-w type(<length>), 10px); }`, expected: ["a"] },
  {
    name: "env/clamp",
    css: `.a { padding: clamp(1rem, 2vw, 2rem) env(safe-area-inset-left); }`,
    expected: ["a"],
  },
  { name: "sibling-index", css: `.a { width: calc(sibling-index() * 1px); }`, expected: ["a"] },
  { name: ":global", css: `:global(.dark) .a { color: var(--fg-base); }`, expected: ["a"] },
  {
    name: "@font-face",
    css: `@font-face { font-family: X; src: url(x.woff2); font-display: swap; }`,
    expected: [],
  },
  {
    name: "light-dark",
    css: `.a { color: light-dark(var(--fg-base), var(--fg-mute)); }`,
    expected: ["a"],
  },
  { name: "transition", css: `.a { transition: color 200ms ease-out; }`, expected: ["a"] },
  {
    name: "gradient",
    css: `.a { background-image: linear-gradient(red, blue); }`,
    expected: ["a"],
  },
];
