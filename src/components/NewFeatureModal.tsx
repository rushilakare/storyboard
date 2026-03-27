import { useState } from "react";
import styles from "./NewFeatureModal.module.css";

interface NewFeatureModalProps {
  onClose: () => void;
  onSubmit: (data: any) => void;
  submitError?: string | null;
}

export default function NewFeatureModal({ onClose, onSubmit, submitError }: NewFeatureModalProps) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [requirements, setRequirements] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, purpose, requirements });
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2 className={styles.title}>New Feature Request</h2>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Feature Name</label>
            <input 
              className={styles.input} 
              placeholder="e.g. Advanced Filtering" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              required 
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Purpose</label>
            <textarea 
              className={styles.textarea} 
              placeholder="Why do we need this?" 
              value={purpose} 
              onChange={e => setPurpose(e.target.value)} 
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Requirements</label>
            <textarea 
              className={styles.textarea} 
              placeholder="List specific requirements or edge cases..." 
              value={requirements} 
              onChange={e => setRequirements(e.target.value)} 
            />
          </div>
          
          <div className={styles.uploadZone} aria-disabled="true" title="Coming soon">
            <span className={styles.uploadText}>
              File uploads are not available yet. Add context in Requirements or use the Knowledge page.
            </span>
          </div>

          {submitError ? (
            <p className={styles.submitError} role="alert">
              {submitError}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.submitBtn}>Start</button>
          </div>
        </form>
      </div>
    </div>
  );
}
