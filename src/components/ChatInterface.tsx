import { useEffect, useRef, useState } from "react";
import styles from "./ChatInterface.module.css";
import ClarifyingQuestionsModal from "./ClarifyingQuestionsModal";
import type { ClarificationAnswers, ClarifyingQuestion } from "@/lib/postInferenceQuestions";

const ALLOWED_ATTACH_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

function effectiveAttachMime(file: File): string {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  let mime = file.type || "application/octet-stream";
  if (mime === "application/octet-stream" && ext === "md") mime = "text/markdown";
  if (mime === "application/octet-stream" && ext === "txt") mime = "text/plain";
  if (mime === "application/octet-stream" && ext === "pdf") mime = "application/pdf";
  if (mime === "application/octet-stream" && ext === "docx")
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return mime;
}

function formatAttachBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  status?: "ready" | "failed";
}

export interface Message {
  id: string;
  role: "user" | "agent";
  agentType?: "inference" | "prd" | "system" | "discussion";
  content: string;
  status?: "pending" | "done" | "needs_review";
  clarifyingQuestions?: ClarifyingQuestion[];
  attachments?: MessageAttachment[];
}

interface ChatProps {
  messages: Message[];
  onSend: (text: string, files?: File[]) => void;
  onStop?: () => void;
  onApprove: (msgId: string, agentType: string) => void;
  isLoading?: boolean;
  loadingLabel?: string;
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
  /** Pending agent command detected from user message — awaiting confirmation. */
  pendingCommand?: { intent: "regenerate_inference" | "generate_prd" | "regenerate_prd"; message: string } | null;
  onCommandConfirm?: () => void;
  onCommandDecline?: () => void;
}

export default function ChatInterface({
  messages,
  onSend,
  onStop,
  onApprove,
  isLoading,
  loadingLabel,
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
  pendingCommand,
  onCommandConfirm,
  onCommandDecline,
}: ChatProps) {
  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function addAttachFiles(incoming: FileList | File[]) {
    const next = [...attachedFiles];
    for (const f of Array.from(incoming)) {
      if (f.size > MAX_ATTACH_BYTES) continue;
      const mime = effectiveAttachMime(f);
      if (!ALLOWED_ATTACH_TYPES.has(mime) && !mime.startsWith("text/")) continue;
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setAttachedFiles(next);
  }

  const handleSend = () => {
    if (!inputText.trim() || isLoading) return;
    onSend(inputText, attachedFiles.length > 0 ? attachedFiles : undefined);
    setInputText("");
    setAttachedFiles([]);
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

              {msg.attachments && msg.attachments.length > 0 && (
                <div className={styles.attachmentChips}>
                  {msg.attachments.map((att) => (
                    <span
                      key={att.id}
                      className={`${styles.attachmentChip} ${att.status === "failed" ? styles.attachmentChipFailed : ""}`}
                      title={att.filename}
                    >
                      <span className={styles.attachmentChipIcon}>📎</span>
                      <span className={styles.attachmentChipName}>
                        {att.filename.length > 24 ? att.filename.slice(0, 22) + "…" : att.filename}
                      </span>
                      {att.status === "failed" && (
                        <span className={styles.attachmentChipBadge}>failed</span>
                      )}
                    </span>
                  ))}
                </div>
              )}

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
              <div className={styles.thinkingBubble}>
                {loadingLabel && (
                  <span className={styles.thinkingLabel}>{loadingLabel}</span>
                )}
                <div className={styles.thinkingDots} aria-label={loadingLabel ?? "Thinking"} role="status">
                  <span className={styles.thinkingDot} />
                  <span className={styles.thinkingDot} />
                  <span className={styles.thinkingDot} />
                </div>
              </div>
            </div>
          </div>
        )}
        {pendingCommand && (
          <div className={`${styles.messageBox} ${styles.agentMsg}`}>
            <div className={styles.avatar}>AI</div>
            <div className={styles.messageContent}>
              <div className={styles.messageText}>
                {pendingCommand.intent === "regenerate_inference"
                  ? "Looks like you want to regenerate the feature inference. Proceed?"
                  : pendingCommand.intent === "generate_prd"
                    ? "Looks like you want to generate the PRD. Proceed?"
                    : "Looks like you want to regenerate the PRD. Proceed?"}
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.approveBtn} onClick={onCommandConfirm}>
                  Yes, proceed
                </button>
                <button type="button" className={styles.reviseBtn} onClick={onCommandDecline}>
                  No, send as message
                </button>
              </div>
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
            <button
              type="button"
              className={styles.attachBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              aria-label="Attach file"
              title="Attach file"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.txt,.md,.csv,.html,.json,.png,.jpg,.jpeg,.webp,.gif"
              style={{ display: "none" }}
              onChange={(e) => e.target.files && addAttachFiles(e.target.files)}
            />
            <div className={styles.composerColumn}>
              {attachedFiles.length > 0 && (
                <div className={styles.composerChips}>
                  {attachedFiles.map((f, i) => (
                    <span key={i} className={styles.composerChip}>
                      <span className={styles.composerChipName}>
                        {f.name.length > 20 ? f.name.slice(0, 18) + "…" : f.name}
                      </span>
                      <span className={styles.composerChipSize}>{formatAttachBytes(f.size)}</span>
                      <button
                        type="button"
                        className={styles.composerChipRemove}
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove ${f.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.textareaRow}>
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
                {isLoading ? (
                  <button className={styles.sendBtn} onClick={onStop} type="button" aria-label="Stop generation">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                  </button>
                ) : (
                  <button className={styles.sendBtn} onClick={handleSend} disabled={!inputText.trim()} type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
