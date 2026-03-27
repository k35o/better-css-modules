import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>better-css-modules</h1>
      <p className={styles.description}>
        CSS Modules with auto-generated type definitions.
      </p>
    </div>
  );
}
