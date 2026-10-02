// Adversarial TypeScript inputs for usage analysis.
// `unused` lists "<css file>:<class>" pairs a human judged to be truly unused,
// `orphans` the CSS files nothing imports, and `unanalyzable` the cases where
// static analysis must give up (dynamic access, value escaping) instead of guessing.
export interface TsCase {
  name: string;
  files: Record<string, string>;
  unused: string[];
  orphans?: string[];
  unanalyzable?: boolean;
}

export const tsCases: TsCase[] = [
  {
    name: "baseline",
    files: {
      "a.module.css": `.used { color: red; } .unused { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.used} />;`,
    },
    unused: ["a.module.css:unused"],
  },
  {
    name: "import-name-not-styles",
    files: {
      "a.module.css": `.used { color: red; } .unused { color: red; }`,
      "a.tsx": `import s from './a.module.css';\nexport const A = () => <div className={s.used} />;`,
    },
    unused: ["a.module.css:unused"],
  },
  {
    name: "two-importers",
    files: {
      "a.module.css": `.x { color: red; } .y { color: red; } .z { color: red; }`,
      "one.tsx": `import styles from './a.module.css';\nexport const One = () => <div className={styles.x} />;`,
      "two.tsx": `import styles from './a.module.css';\nexport const Two = () => <div className={styles.y} />;`,
    },
    unused: ["a.module.css:z"],
  },
  {
    name: "dynamic-access",
    files: {
      "a.module.css": `.sm { color: red; } .md { color: red; } .lg { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = ({ size }: { size: 'sm' | 'md' | 'lg' }) => <div className={styles[size]} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "dynamic-access-through-cast",
    files: {
      "a.module.css": `.sm { color: red; } .md { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = ({ size }: { size: string }) => <div className={(styles as Record<string, string>)[size]} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "non-null-and-satisfies",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; } .c { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles!.a + (styles satisfies object).b} />;`,
    },
    unused: ["a.module.css:c"],
  },
  {
    name: "template-literal-access",
    files: {
      "a.module.css": `.size-sm { color: red; } .size-md { color: red; } .other { color: red; }`,
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = ({ size }: { size: 'sm' | 'md' }) => <div className={styles[`size-${size}`]} />;",
    },
    unused: ["a.module.css:other"],
  },
  {
    name: "template-literal-access-with-a-static-suffix",
    files: {
      "a.module.css": `.sm-gap { color: red; } .md-gap { color: red; } .other { color: red; }`,
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = ({ size }: { size: 'sm' | 'md' }) => <div className={styles[`${size}-gap`]} />;",
    },
    unused: ["a.module.css:other"],
  },
  {
    name: "template-literal-access-with-no-static-part",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = ({ x }: { x: string }) => <div className={styles[`${x}`]} />;",
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "template-literal-access-with-only-a-static-middle",
    files: {
      "a.module.css": `.a-b { color: red; } .c { color: red; }`,
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = ({ x, y }: { x: string; y: string }) => <div className={styles[`${x}-${y}`]} />;",
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "cn-helper",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; } .c { color: red; }`,
      "cn.ts": `export const cn = (...xs: unknown[]) => xs.filter(Boolean).join(' ');`,
      "a.tsx": `import styles from './a.module.css';\nimport { cn } from './cn';\nexport const A = ({ cond }: { cond: boolean }) => <div className={cn(styles.a, cond && styles.b)} />;`,
    },
    unused: ["a.module.css:c"],
  },
  {
    name: "optional-chaining",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; } .c { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles?.a + styles?.["b"]} />;`,
    },
    unused: ["a.module.css:c"],
  },
  {
    name: "computed-key-of-a-class-map",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nimport cx from './cx';\nexport const A = ({ on }: { on: boolean }) => <div className={cx({ [styles.a]: on })} />;`,
      "cx.ts": `export default (map: Record<string, boolean>) => Object.keys(map).filter((k) => map[k]).join(' ');`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "class-names-bind",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nimport classNames from './class-names';\nconst cx = classNames.bind(styles);\nexport const A = () => <div className={cx('a')} />;`,
      "class-names.ts": `export default { bind: (map: Record<string, string>) => (k: string) => map[k] };`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "destructuring",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; } .c { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nconst { a, b: renamed } = styles;\nexport const A = () => <div className={a + renamed} />;`,
    },
    unused: ["a.module.css:c"],
  },
  {
    name: "rest-destructuring",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nconst { a, ...rest } = styles;\nexport const A = () => <div className={a} {...rest} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "re-export",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "index.ts": `export { default as styles } from './a.module.css';`,
      "user.tsx": `import { styles } from './index';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "re-export-default",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "index.ts": `export { default } from './a.module.css';`,
      "user.tsx": `import styles from './index';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "export-of-a-local-binding",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "index.ts": `import styles from './a.module.css';\nexport { styles };`,
      "user.tsx": `import { styles } from './index';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "export-default-of-a-local-binding",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "index.ts": `import styles from './a.module.css';\nexport default styles;`,
      "user.tsx": `import styles from './index';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "re-export-through-barrel-of-barrels",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "inner.ts": `export { default as styles } from './a.module.css';`,
      "index.ts": `export { styles } from './inner';`,
      "user.tsx": `import { styles } from './index';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "namespace-import-of-barrel",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "index.ts": `export { default as styles } from './a.module.css';`,
      "user.tsx": `import * as ui from './index';\nexport const A = () => <div className={ui.styles.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "re-export-wholesale",
    files: {
      "a.module.css": `.a { color: red; }`,
      "index.ts": `export * from './a.module.css';`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "re-export-as-a-namespace",
    files: {
      "a.module.css": `.a { color: red; }`,
      "index.ts": `export * as styles from './a.module.css';`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "namespace-import",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import * as styles from './a.module.css';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "default-member-of-a-namespace-import",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; } .c { color: red; }`,
      "a.tsx": `import * as s from './a.module.css';\nexport const A = () => <div className={s.default.a + s["default"]?.b} />;`,
    },
    unused: ["a.module.css:c"],
  },
  {
    name: "default-member-of-a-namespace-import-escaping",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import * as s from './a.module.css';\nimport { Child } from './child';\nexport const A = () => <Child classes={s.default} />;`,
      "child.tsx": `export const Child = ({ classes }: { classes: Record<string, string> }) => <div className={classes.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "default-member-of-a-namespace-import-destructured",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import * as s from './a.module.css';\nconst { default: styles } = s;\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "named-import",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import { a } from './a.module.css';\nexport const A = () => <div className={a} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "named-import-of-a-name-that-is-not-an-identifier",
    files: {
      "a.module.css": `.primary-btn { color: red; } .b { color: red; }`,
      "a.tsx": `import { "primary-btn" as primary } from './a.module.css';\nexport const A = () => <div className={primary} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "named-default-import",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import { default as s } from './a.module.css';\nexport const A = () => <div className={s.a} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "side-effect-import",
    files: {
      "a.module.css": `.a { color: red; }`,
      "a.tsx": `import './a.module.css';\nexport const A = () => <div className="a" />;`,
    },
    unused: ["a.module.css:a"],
  },
  {
    name: "type-only-import",
    files: {
      "a.module.css": `.a { color: red; }`,
      "a.tsx": `import type styles from './a.module.css';\nexport type Keys = keyof typeof styles;`,
    },
    unused: [],
    orphans: ["a.module.css"],
  },
  {
    name: "type-query-of-a-value-import",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\ntype Variant = keyof typeof styles;\nexport const A = ({ v }: { v: Variant }) => <div className={styles.a} data-v={v} />;\nexport const keys: Array<typeof styles> = [];`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "type-query-of-a-class-is-not-a-use",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport type A = typeof styles.a;\nexport const B = () => <div className={styles.b} />;`,
    },
    unused: ["a.module.css:a"],
  },
  {
    name: "js-extension-import",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "index.ts": `export { default as styles } from './a.module.css';`,
      "user.tsx": `import { styles } from './index.js';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "two-modules-in-one-file",
    files: {
      "a.module.css": `.title { color: red; }`,
      "b.module.css": `.title { color: red; } .body { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nimport other from './b.module.css';\nexport const A = () => <div className={styles.title}><p className={other.body} /></div>;`,
    },
    unused: ["b.module.css:title"],
  },
  {
    name: "comment-and-string",
    files: {
      "a.module.css": `.a { color: red; } .ghost { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\n// TODO: use styles.ghost later\nconst doc = "styles.ghost";\nexport const A = () => <div className={styles.a} title={doc} />;`,
    },
    unused: ["a.module.css:ghost"],
  },
  {
    name: "other-object-named-styles",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import css from './a.module.css';\nconst theme = { styles: { b: 1 } };\nexport const A = () => <div className={css.a} data-x={theme.styles.b} />;`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "never-imported-module",
    files: {
      "orphan.module.css": `.a { color: red; }`,
      "a.tsx": `export const A = () => <div />;`,
    },
    unused: [],
    orphans: ["orphan.module.css"],
  },
  {
    name: "path-alias",
    files: {
      "src/a.module.css": `.a { color: red; } .b { color: red; }`,
      "src/a.tsx": `import styles from '@/a.module.css';\nexport const A = () => <div className={styles.a} />;`,
      "tsconfig.json": `{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}`,
    },
    unused: ["src/a.module.css:b"],
  },
  {
    name: "package-imports-alias",
    files: {
      "package.json": `{"name":"app","imports":{"#styles/*":"./src/styles/*"}}`,
      "src/styles/a.module.css": `.a { color: red; } .b { color: red; }`,
      "src/a.tsx": `import styles from '#styles/a.module.css';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: ["src/styles/a.module.css:b"],
  },
  {
    name: "require-is-not-an-import",
    files: {
      "a.module.css": `.a { color: red; }`,
      "a.cjs": `const styles = require('./a.module.css');\nmodule.exports = styles.a;`,
    },
    unused: [],
    orphans: ["a.module.css"],
  },
  {
    name: "global-and-keyframes",
    files: {
      "a.module.css": `:global(.dark) .bg { color: red; } @keyframes fade { to { opacity: 1 } } .anim { animation: fade 1s; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.bg + styles.anim} />;`,
    },
    unused: [],
  },
  {
    name: "unreferenced-keyframes-are-not-reported",
    files: {
      "a.module.css": `.a { color: red; } @keyframes unusedFade { to { opacity: 1 } }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: [],
  },
  {
    name: "passed-as-prop",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nimport { Child } from './child';\nexport const A = () => <Child classes={styles} />;`,
      "child.tsx": `export const Child = ({ classes }: { classes: Record<string, string> }) => <div className={classes.a} />;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "composes-cycle",
    files: {
      "a.module.css": `.a { composes: b; color: red; } .b { composes: a; color: red; } .c { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: ["a.module.css:c"],
  },
  {
    name: "value-import-counts-as-importer",
    files: {
      "tokens.module.css": `@value primary: red;`,
      "a.module.css": `@value primary from './tokens.module.css';\n.a { color: primary; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.a} />;`,
    },
    unused: [],
  },
  {
    name: "unparsable-source",
    files: {
      "a.module.css": `.a { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.a} />\nconst broken = ;`,
    },
    unused: [],
    unanalyzable: true,
  },
  {
    name: "node-modules-and-out-dir-are-ignored",
    files: {
      "a.module.css": `.a { color: red; }`,
      "a.tsx": `import styles from './a.module.css';\nexport const A = () => <div className={styles.a} />;`,
      "node_modules/dep/x.module.css": `.dep { color: red; }`,
      "node_modules/dep/index.ts": `import s from './x.module.css'; export const y = s.zzz;`,
      "__generated__/a.module.css.d.ts": `declare const styles: {}; export default styles;`,
    },
    unused: [],
  },
  {
    name: "build-output-directories-are-ignored",
    files: {
      "a.module.css": `.a { color: red; } .b { color: red; }`,
      "src/a.tsx": `import styles from '../a.module.css';\nexport const A = () => <div className={styles.a} />;`,
      "dist/x.js": `import s from '../a.module.css'; export const y = (k) => s[k];`,
      "build/x.js": `import s from '../a.module.css'; export const y = (k) => s[k];`,
      "out/x.js": `import s from '../a.module.css'; export const y = (k) => s[k];`,
      "coverage/x.js": `import s from '../a.module.css'; export const y = (k) => s[k];`,
      "storybook-static/x.js": `import s from '../a.module.css'; export const y = (k) => s[k];`,
    },
    unused: ["a.module.css:b"],
  },
  {
    name: "directories-named-like-build-outputs-below-the-root-are-scanned",
    files: {
      "src/app/build/page.module.css": `.a { color: red; }`,
      "src/app/build/page.tsx": `import styles from './page.module.css';\nexport default () => <div className={styles.a} />;`,
      "src/components/out/Out.module.css": `.a { color: red; }`,
      "src/components/out/Out.tsx": `import styles from './Out.module.css';\nexport const Out = () => <div className={styles.a} />;`,
    },
    unused: [],
  },
  {
    name: "dot-directories-are-not-scanned",
    files: {
      "a.module.css": `.a { color: red; }`,
      ".storybook/preview.tsx": `import styles from '../a.module.css';\nexport const decorators = [() => <div className={styles.a} />];`,
    },
    unused: [],
    orphans: ["a.module.css"],
  },
  {
    name: "declaration-files-are-not-scanned",
    files: {
      "a.module.css": `.a { color: red; }`,
      "types.d.ts": `export * from './a.module.css';`,
    },
    unused: [],
    orphans: ["a.module.css"],
  },
];
