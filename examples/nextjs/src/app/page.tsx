import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>better-css-modules</h1>
      <p className={styles.description}>
        CSS Modules with auto-generated type definitions (Next.js example).
      </p>
    </div>
  );
}
