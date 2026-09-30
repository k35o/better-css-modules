// Adversarial CSS inputs. `expected` lists the keys of the module's default
// export under CSS Modules semantics (sorted); `classes` lists the local class
// names when they differ from the keys. Cases where a bundler exports something
// else are marked with `divergent` and pinned down in bundler-parity.test.ts.
export interface CssCase {
  name: string;
  css: string;
  expected: string[];
  classes?: string[];
  /** Bundlers whose export keys differ from `expected` for this input. */
  divergent?: { lightningcss?: string[]; postcssModules?: string[] };
}

export const cssCases: CssCase[] = [
  {
    name: "global-fn",
    css: `:global(.dark) .background { color: red; }`,
    expected: ["background"],
  },
  {
    name: "global-block",
    css: `:global { .foo { color: red; } }`,
    expected: [],
    divergent: { postcssModules: ["foo"] },
  },
  { name: "global-bare", css: `:global .foo .bar { color: red; }`, expected: [] },
  { name: "local-fn", css: `:local(.a) { color: red; }`, expected: ["a"] },
  {
    name: "nesting",
    css: `.a { color: red; &:hover { color: blue; } .b { color: green; } & + .c { color: pink; } }`,
    expected: ["a", "b", "c"],
  },
  { name: "at-media", css: `@media (width >= 768px) { .m { color: red; } }`, expected: ["m"] },
  {
    name: "at-container",
    css: `.wrap { container-type: inline-size; container-name: card; } @container card (width >= 40cqi) { .ct { color: red; } }`,
    expected: ["ct", "wrap"],
  },
  { name: "at-layer", css: `@layer components { .ly { color: red; } }`, expected: ["ly"] },
  {
    name: "at-scope",
    css: `@scope (.card) to (.content) { .title { color: red; } }`,
    expected: ["card", "content", "title"],
  },
  {
    name: "at-supports-starting-style",
    css: `@supports (display: grid) { .sp { display: grid; @starting-style { opacity: 0; } } }`,
    expected: ["sp"],
  },
  {
    name: "composes-local",
    css: `.base { color: red; } .ext { composes: base; font-size: 16px; }`,
    expected: ["base", "ext"],
  },
  {
    name: "composes-from",
    css: `.x { composes: a b from './b.module.css'; color: red; }`,
    expected: ["x"],
  },
  {
    name: "composes-global",
    css: `.y { composes: dark from global; color: red; }`,
    expected: ["y"],
  },
  {
    name: "at-value",
    css: `@value primary: #0c77f8; @value small from './bp.module.css'; .v { color: primary; }`,
    expected: ["v"],
    divergent: { postcssModules: ["primary", "small", "v"] },
  },
  {
    name: "attr-dot",
    css: `.link[data-x="a.b"] { color: red; } a[href$=".pdf"] { color: red; }`,
    expected: ["link"],
  },
  { name: "nth-child", css: `.row:nth-child(2n+1) { color: red; }`, expected: ["row"] },
  {
    name: "escaped",
    css: `.sm\\:hidden { display: none; } .w-1\\/2 { width: 50%; } .\\31 0px { width: 10px; }`,
    expected: ["10px", "sm:hidden", "w-1/2"],
  },
  {
    name: "keyframes",
    css: `@keyframes fade { 0% { opacity: 0; } 50.5% { opacity: .5; } to { opacity: 1; } } .anim { animation: fade 1s; }`,
    expected: ["anim", "fade"],
    classes: ["anim"],
  },
  {
    name: "keyframes-only",
    css: `@keyframes spin { to { transform: rotate(1turn); } }`,
    expected: ["spin"],
    classes: [],
  },
  {
    name: "animation-undeclared",
    css: `.a { animation: 1s ease-in-out infinite alternate spin; }`,
    expected: ["a", "spin"],
    classes: ["a"],
  },
  {
    name: "animation-name-undeclared",
    css: `.a { animation-name: spin, none; }`,
    expected: ["a", "spin"],
    classes: ["a"],
  },
  {
    name: "animation-with-var",
    css: `.a { animation: spin var(--duration) ease-in; }`,
    expected: ["a", "spin"],
    classes: ["a"],
  },
  {
    name: "animation-name-var-only",
    css: `.a { animation-name: var(--name); }`,
    expected: ["a"],
  },
  {
    name: "animation-webkit",
    css: `.a { -webkit-animation: spin 1s; -webkit-animation-name: spin; }`,
    expected: ["a", "spin"],
    classes: ["a"],
  },
  {
    name: "animation-string-name",
    css: `.a { animation-name: "quoted"; }`,
    expected: ["a"],
    divergent: { lightningcss: ["a", "quoted"] },
  },
  {
    name: "container-name",
    css: `.host { container: sidebar / inline-size; }`,
    expected: ["host"],
  },
  {
    name: "id",
    css: `#hero { color: red; } .a { color: red; }`,
    expected: ["a", "hero"],
    classes: ["a"],
  },
  { name: "id-global", css: `:global(#hero) { color: red; } .a { color: red; }`, expected: ["a"] },
  {
    name: "id-nested-global",
    css: `:global { #hero { color: red; } } .a { color: red; }`,
    expected: ["a"],
    divergent: { postcssModules: ["a", "hero"] },
  },
  {
    name: "pseudo-fn",
    css: `.p:is(.q, .r):not(.s):has(> .t) { color: red; }`,
    expected: ["p", "q", "r", "s", "t"],
  },
  {
    name: "compound",
    css: `.btn.primary > .icon ~ .label { color: red; }`,
    expected: ["btn", "icon", "label", "primary"],
  },
  {
    name: "unicode",
    css: `.日本語 { color: red; } .café { color: red; }`,
    expected: ["café", "日本語"],
  },
  { name: "comment-in-selector", css: `.a /* .ghost */ .b { color: red; }`, expected: ["a", "b"] },
  {
    name: "url-in-value-not-selector",
    css: `.bg { background: url(./img.v2.png); }`,
    expected: ["bg"],
  },
  {
    name: "view-transition",
    css: `::view-transition-old(.card) { animation: none; } .vt { view-transition-class: card; }`,
    expected: ["card", "vt"],
    classes: ["vt"],
  },
  {
    name: "view-transition-pseudo-only",
    css: `::view-transition-group(.hero) { animation: none; }`,
    expected: ["hero"],
    classes: [],
  },
  {
    name: "view-transition-name",
    css: `.a { view-transition-name: hero; }`,
    expected: ["a"],
    divergent: { lightningcss: ["a", "hero"] },
  },
  {
    name: "view-transition-pseudo-ident",
    css: `::view-transition-group(hero) { animation: none; }`,
    expected: [],
    divergent: { lightningcss: ["hero"] },
  },
  {
    name: "grid-areas",
    css: `.a { grid-template-areas: 'head' 'main'; } .b { grid-area: head; }`,
    expected: ["a", "b"],
  },
  {
    name: "dashed-ident",
    css: `.tok { --local-color: red; color: var(--local-color); }`,
    expected: ["tok"],
  },
];
