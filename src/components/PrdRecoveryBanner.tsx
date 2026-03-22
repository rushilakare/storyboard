"use client";

import styles from "./PrdRecoveryBanner.module.css";

export default function PrdRecoveryBanner({
  hasDraft,
  busy,
  onContinue,
  onRegenerate,
  onEditManually,
}: {
  hasDraft: boolean;
  busy: boolean;
  onContinue: () => void;
  onRegenerate: () => void;
  onEditManually: () => void;
}) {
  return (
    <div className={styles.banner} role="region" aria-label="PRD generation recovery">
      <h3 className={styles.title}>PRD generation did not finish</h3>
      <p className={styles.description}>
        {hasDraft
          ? "A partial draft was saved. You can keep generating from it, start over, or edit the draft manually."
          : "No draft was saved yet. You can regenerate the PRD or switch to manual editing when you have content."}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={busy}
          onClick={onContinue}
        >
          Continue generating
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={onRegenerate}>
          Regenerate from scratch
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={onEditManually}
        >
          Edit draft manually
        </button>
      </div>
    </div>
  );
}
