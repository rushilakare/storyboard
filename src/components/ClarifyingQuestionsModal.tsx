import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./ClarifyingQuestionsModal.module.css";
import type { ClarifyingQuestion, ClarificationAnswers } from "@/lib/postInferenceQuestions";

interface Props {
  questions: ClarifyingQuestion[];
  onComplete: (answers: ClarificationAnswers) => void;
  onClose: () => void;
  /** Shown before the first feature inference draft (copy + skip-all affordances). */
  preInference?: boolean;
  /** Skip every question and continue (parent runs inference without Q&A). */
  onSkipAll?: () => void;
}

export default function ClarifyingQuestionsModal({
  questions,
  onComplete,
  onClose,
  preInference = false,
  onSkipAll,
}: Props) {
  const questionsKey = questions.map((q) => q.id).join("|");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<ClarificationAnswers>({});
  const [focusIdx, setFocusIdx] = useState(0);
  const [otherText, setOtherText] = useState("");
  const [otherActive, setOtherActive] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const otherInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const resetStepState = useCallback((targetStep: number, sourceAnswers: ClarificationAnswers) => {
    setFocusIdx(0);
    const tq = questions[targetStep];
    if (!tq) return;
    if (tq.type === "text") {
      const prev = sourceAnswers[tq.id];
      setTextDraft(typeof prev === "string" ? prev : "");
      setOtherText("");
      setOtherActive(false);
    } else if (tq.type === "multiple_with_other") {
      const prev = sourceAnswers[tq.id];
      if (prev && typeof prev === "object" && "selected" in prev) {
        setOtherText(prev.other ?? "");
        setOtherActive(!!prev.other);
      } else {
        setOtherText("");
        setOtherActive(false);
      }
      setTextDraft("");
    } else {
      setOtherText("");
      setOtherActive(false);
      setTextDraft("");
    }
  }, [questions]);

  useEffect(() => {
    const empty: ClarificationAnswers = {};
    setStep(0);
    setAnswers(empty);
    setFocusIdx(0);
    resetStepState(0, empty);
  }, [questionsKey, resetStepState]);

  const q = questions[step];
  const isMulti = q.type === "multiple" || q.type === "multiple_with_other";
  const hasOther = q.type === "multiple_with_other";
  const isText = q.type === "text";
  const totalRows = q.options.length + (hasOther ? 1 : 0);

  const currentMultiSelected = (): string[] => {
    const val = answers[q.id];
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object" && "selected" in val) return val.selected;
    return [];
  };

  const commitTextAndMaybeAdvance = useCallback(
    (nextAnswers: ClarificationAnswers) => {
      setAnswers(nextAnswers);
      if (step < questions.length - 1) {
        const next = step + 1;
        setStep(next);
        resetStepState(next, nextAnswers);
      } else {
        onComplete(nextAnswers);
      }
    },
    [step, questions.length, onComplete, resetStepState],
  );

  const advance = useCallback(() => {
    if (step < questions.length - 1) {
      const next = step + 1;
      setStep(next);
      resetStepState(next, answers);
    } else {
      onComplete(answers);
    }
  }, [step, questions.length, answers, onComplete, resetStepState]);

  const goBack = useCallback(() => {
    if (step > 0) {
      const prev = step - 1;
      setStep(prev);
      resetStepState(prev, answers);
    }
  }, [step, answers, resetStepState]);

  const skip = useCallback(() => {
    const merged = { ...answers, [q.id]: null };
    setAnswers(merged);
    if (step < questions.length - 1) {
      const next = step + 1;
      setStep(next);
      resetStepState(next, merged);
    } else {
      onComplete(merged);
    }
  }, [q.id, step, questions.length, answers, onComplete, resetStepState]);

  const confirmText = useCallback(() => {
    const trimmed = textDraft.trim();
    const nextAnswers = { ...answers, [q.id]: trimmed ? trimmed : null };
    commitTextAndMaybeAdvance(nextAnswers);
  }, [textDraft, answers, q.id, commitTextAndMaybeAdvance]);

  const selectSingle = useCallback(
    (optionId: string) => {
      setAnswers((prev) => ({ ...prev, [q.id]: optionId }));
      setTimeout(advance, 120);
    },
    [q.id, advance],
  );

  const toggleMulti = useCallback(
    (optionId: string) => {
      const sel = currentMultiSelected();
      const next = sel.includes(optionId)
        ? sel.filter((s) => s !== optionId)
        : [...sel, optionId];

      if (hasOther) {
        setAnswers((prev) => ({
          ...prev,
          [q.id]: { selected: next, ...(otherText ? { other: otherText } : {}) },
        }));
      } else {
        setAnswers((prev) => ({ ...prev, [q.id]: next }));
      }
    },
    [q.id, hasOther, otherText, answers],
  );

  const confirmMulti = useCallback(() => {
    if (hasOther) {
      const sel = currentMultiSelected();
      setAnswers((prev) => ({
        ...prev,
        [q.id]: {
          selected: sel,
          ...(otherText.trim() ? { other: otherText.trim() } : {}),
        },
      }));
    }
    advance();
  }, [hasOther, otherText, q.id, advance, answers]);

  const handleNextNav = useCallback(() => {
    if (isText) {
      confirmText();
      return;
    }
    advance();
  }, [isText, confirmText, advance]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (preInference && onSkipAll) {
          onSkipAll();
        } else {
          skip();
        }
        return;
      }

      if (isText && document.activeElement === textAreaRef.current) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          confirmText();
        }
        return;
      }

      if (otherActive && document.activeElement === otherInputRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmMulti();
        }
        return;
      }

      if (isText) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusIdx((prev) => Math.min(prev + 1, totalRows - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (focusIdx < q.options.length) {
          if (isMulti) {
            toggleMulti(q.options[focusIdx].id);
          } else {
            selectSingle(q.options[focusIdx].id);
          }
        } else if (hasOther) {
          setOtherActive(true);
          setTimeout(() => otherInputRef.current?.focus(), 0);
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < q.options.length) {
          setFocusIdx(idx);
          if (isMulti) {
            toggleMulti(q.options[idx].id);
          } else {
            selectSingle(q.options[idx].id);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    focusIdx,
    totalRows,
    q,
    isMulti,
    hasOther,
    isText,
    otherActive,
    selectSingle,
    toggleMulti,
    confirmMulti,
    confirmText,
    skip,
    preInference,
    onSkipAll,
  ]);

  useEffect(() => {
    modalRef.current?.focus();
  }, [step]);

  if (questions.length === 0) {
    return null;
  }

  const multiSel = currentMultiSelected();
  const nextNavDisabled = step === questions.length - 1 && !isMulti && !isText;

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={q.title}
        ref={modalRef}
        tabIndex={-1}
      >
        {preInference ? (
          <p className={styles.preInferenceNote}>
            Answer a few questions to sharpen the draft — or skip to generate the feature inference now.
          </p>
        ) : null}
        <div className={styles.header}>
          <span className={styles.questionTitle}>{q.title}</span>
          <div className={styles.headerRight}>
            <button
              className={styles.navBtn}
              onClick={goBack}
              disabled={step === 0}
              aria-label="Previous question"
            >
              ‹
            </button>
            <span className={styles.progress}>
              {step + 1} of {questions.length}
            </span>
            <button
              className={styles.navBtn}
              onClick={handleNextNav}
              disabled={nextNavDisabled}
              aria-label="Next question"
            >
              ›
            </button>
            <button
              className={styles.closeBtn}
              onClick={preInference && onSkipAll ? onSkipAll : onClose}
              aria-label={preInference ? "Skip all questions" : "Close"}
            >
              ×
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {isText ? (
            <textarea
              ref={textAreaRef}
              className={styles.textArea}
              placeholder="Type your answer…"
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              rows={5}
            />
          ) : (
            <>
              {q.options.map((opt, idx) => {
                const isSel = isMulti
                  ? multiSel.includes(opt.id)
                  : answers[q.id] === opt.id;

                return (
                  <div
                    key={opt.id}
                    className={[
                      styles.optionRow,
                      focusIdx === idx ? styles.focused : "",
                      isSel ? styles.selected : "",
                    ].join(" ")}
                    onClick={() => {
                      setFocusIdx(idx);
                      if (isMulti) toggleMulti(opt.id);
                      else selectSingle(opt.id);
                    }}
                    onMouseEnter={() => setFocusIdx(idx)}
                  >
                    {isMulti ? (
                      <span
                        className={`${styles.checkbox} ${isSel ? styles.checked : ""}`}
                      >
                        {isSel && <span className={styles.checkIcon}>✓</span>}
                      </span>
                    ) : (
                      <span className={styles.badge}>{idx + 1}</span>
                    )}
                    <span className={styles.optionLabel}>{opt.label}</span>
                    {!isMulti && <span className={styles.arrow}>→</span>}
                  </div>
                );
              })}

              {hasOther && (
                <div
                  className={[
                    styles.otherRow,
                    focusIdx === q.options.length ? styles.focused : "",
                    otherActive ? styles.selected : "",
                  ].join(" ")}
                  onClick={() => {
                    setFocusIdx(q.options.length);
                    setOtherActive(true);
                    setTimeout(() => otherInputRef.current?.focus(), 0);
                  }}
                  onMouseEnter={() => setFocusIdx(q.options.length)}
                >
                  <span className={styles.pencilIcon}>✎</span>
                  <input
                    ref={otherInputRef}
                    className={styles.otherInput}
                    placeholder="Something else"
                    value={otherText}
                    onChange={(e) => {
                      setOtherText(e.target.value);
                      setOtherActive(true);
                      const sel = currentMultiSelected();
                      setAnswers((prev) => ({
                        ...prev,
                        [q.id]: {
                          selected: sel,
                          ...(e.target.value.trim()
                            ? { other: e.target.value.trim() }
                            : {}),
                        },
                      }));
                    }}
                    onFocus={() => {
                      setOtherActive(true);
                      setFocusIdx(q.options.length);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.hints}>
            {isText ? (
              <span className={styles.hint}>
                <span className={styles.hintKey}>⌘↵ / Ctrl+↵</span> continue
              </span>
            ) : (
              <>
                <span className={styles.hint}>
                  <span className={styles.hintKey}>↑↓</span> navigate
                </span>
                <span className={styles.hint}>
                  <span className={styles.hintKey}>Enter</span> select
                </span>
              </>
            )}
            <span className={styles.hint}>
              <span className={styles.hintKey}>Esc</span>{" "}
              {preInference && onSkipAll ? "skip all" : "skip"}
            </span>
          </div>
          <div className={styles.footerActions}>
            {preInference && onSkipAll ? (
              <button type="button" className={styles.skipAllBtn} onClick={onSkipAll}>
                Skip all
              </button>
            ) : null}
            <button className={styles.skipBtn} onClick={skip}>
              Skip
            </button>
            {(isMulti || isText) && (
              <button
                className={styles.continueBtn}
                onClick={isText ? confirmText : confirmMulti}
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
