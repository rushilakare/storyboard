import { useEffect, useRef, useState } from "react";
import styles from "./ChatInterface.module.css";
import ClarifyingQuestionsModal from "./ClarifyingQuestionsModal";
import type { ClarificationAnswers, ClarifyingQuestion } from "@/lib/postInferenceQuestions";

export interface Message {
  id: string;
  role: "user" | "agent";
  agentType?: "inference" | "prd" | "system" | "discussion";
  content: string;
  status?: "pending" | "done" | "needs_review";
  clarifyingQuestions?: ClarifyingQuestion[];
}

interface ChatProps {
  messages: Message[];
  onSend: (text: string) => void;
  onApprove: (msgId: string, agentType: string) => void;
  isLoading?: boolean;
  onViewDocument?: () => void;
  onViewAgentDocument?: (kind: "inference") => void;
  clarifyingOpen?: boolean;
  clarifyingQuestions?: ClarifyingQuestion[];
  onClarifyComplete?: (answers: ClarificationAnswers) => void;
  onClarifyClose?: () => void;
  onUpdateInference?: () => void;
  /** When true, composer shows revision-oriented placeholder until next send. */
  inferenceReviseHint?: boolean;
  /** Increment to focus the composer (e.g. after closing clarifying modal for rework). */
  focusComposerToken?: number;
  /** Overrides default revise placeholder. */
  composerPlaceholder?: string;
  /** Clarifying modal opened before the first inference draft. */
  clarifyingPreInference?: boolean;
  /** Skip all pre-inference questions and proceed to inference. */
  onClarifySkipAll?: () => void;
}

export default function ChatInterface({
  messages,
  onSend,
  onApprove,
  isLoading,
  onViewDocument,
  onViewAgentDocument,
  clarifyingOpen,
  clarifyingQuestions = [],
  onClarifyComplete,
  onClarifyClose,
  onUpdateInference,
  inferenceReviseHint = false,
  focusComposerToken = 0,
  composerPlaceholder,
  clarifyingPreInference = false,
  onClarifySkipAll,
}: ChatProps) {
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusTokenRef = useRef(0);

  useEffect(() => {
    if (focusComposerToken <= 0 || focusComposerToken === lastFocusTokenRef.current) return;
    lastFocusTokenRef.current = focusComposerToken;
    if (clarifyingOpen) return;
    textareaRef.current?.focus();
  }, [focusComposerToken, clarifyingOpen]);

  const placeholder =
    isLoading
      ? "Please wait..."
      : inferenceReviseHint
        ? "Describe what to change in the feature inference…"
        : (composerPlaceholder ?? "Type a message to revise…");

  const handleSend = () => {
    if (!inputText.trim() || isLoading) return;
    onSend(inputText);
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.chatContainer}>
      <div className={styles.messageList}>
        <div className={styles.messageListColumn}>
        {messages.map((msg) => (
          <div key={msg.id} className={`${styles.messageBox} ${msg.role === "user" ? styles.userMsg : styles.agentMsg}`}>
            <div className={styles.avatar}>
              {msg.role === "user" ? "ME" : "AI"}
            </div>
            <div className={styles.messageContent}>
              <div className={styles.messageHeader}>
                <span className={styles.senderName}>
                  {msg.role === "user"
                    ? "You"
                    : msg.agentType === "prd"
                      ? "Document Agent"
                      : msg.agentType === "system"
                        ? "System"
                        : msg.agentType === "discussion"
                          ? "Assistant"
                          : "Product AI"}
                </span>
              </div>
              <div className={styles.messageText}>
                {msg.content}
              </div>

              {msg.status === "needs_review" &&
                !isLoading &&
                msg.agentType === "inference" && (
                  <div className={styles.actions}>
                    {onViewAgentDocument ? (
                      <button
                        type="button"
                        className={styles.reviseBtn}
                        onClick={() => onViewAgentDocument("inference")}
                      >
                        View feature inference
                      </button>
                    ) : null}
                    {onUpdateInference ? (
                      <button
                        type="button"
                        className={styles.updateInferenceBtn}
                        onClick={onUpdateInference}
                      >
                        Update feature inference
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.approveBtn}
                      onClick={() => onApprove(msg.id, msg.agentType!)}
                    >
                      Looks Good (Proceed)
                    </button>
                  </div>
                )}

              {msg.status === "needs_review" && !isLoading && msg.agentType === "prd" && (
                <div className={styles.actions}>
                  <button type="button" className={styles.approveBtn} onClick={() => onApprove(msg.id, "prd")}>
                    Looks Good (Proceed)
                  </button>
                </div>
              )}

              {msg.agentType === "inference" && msg.status === "done" && onViewAgentDocument && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.reviseBtn}
                    onClick={() => onViewAgentDocument("inference")}
                  >
                    View feature inference
                  </button>
                </div>
              )}

              {msg.agentType === "prd" && msg.status === "done" && (
                <div className={styles.actions}>
                  <button type="button" className={styles.approveBtn} onClick={onViewDocument}>
                    View PRD Document
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className={`${styles.messageBox} ${styles.agentMsg}`}>
             <div className={styles.avatar}>AI</div>
             <div className={styles.messageContent}>
                <div className={styles.messageText}>Thinking...</div>
             </div>
          </div>
        )}
        </div>
      </div>

      {clarifyingOpen && onClarifyComplete && onClarifyClose && (
        <ClarifyingQuestionsModal
          questions={clarifyingQuestions}
          onComplete={onClarifyComplete}
          onClose={onClarifyClose}
          preInference={clarifyingPreInference}
          onSkipAll={clarifyingPreInference ? onClarifySkipAll : undefined}
        />
      )}

      {!clarifyingOpen && (
        <div className={styles.inputArea}>
          <div className={styles.inputWrapper}>
            <textarea
              ref={textareaRef}
              className={styles.chatInput}
              placeholder={placeholder}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button className={styles.sendBtn} onClick={handleSend} disabled={isLoading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
