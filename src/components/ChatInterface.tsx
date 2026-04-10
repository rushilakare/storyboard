import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
const MAX_ATTACH_COUNT = 5;

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

export interface UploadedAttachment {
  id: string;
  filename: string;
  mime_type: string;
  status: "ready" | "failed";
}

type AttachState = {
  localKey: string;
  file: File;
  filename: string;
  mime_type: string;
  byte_size: number;
  status: "uploading" | "ready" | "failed";
  id?: string;
};

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
  onSend: (text: string, attachments?: UploadedAttachment[]) => void;
  uploadFile?: (file: File) => Promise<UploadedAttachment>;
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
  uploadFile,
}: ChatProps) {
  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachState[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFocusTokenRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

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

  const triggerUpload = useCallback(async (entry: AttachState) => {
    if (!uploadFile) {
      // No upload handler — mark ready immediately (caller handles nothing)
      setAttachedFiles((prev) =>
        prev.map((a) => a.localKey === entry.localKey ? { ...a, status: "ready" as const } : a),
      );
      return;
    }
    try {
      const result = await uploadFile(entry.file);
      setAttachedFiles((prev) =>
        prev.map((a) =>
          a.localKey === entry.localKey
            ? { ...a, id: result.id, status: result.status }
            : a,
        ),
      );
    } catch {
      setAttachedFiles((prev) =>
        prev.map((a) =>
          a.localKey === entry.localKey ? { ...a, status: "failed" as const } : a,
        ),
      );
    }
  }, [uploadFile]);

  function addAttachFiles(incoming: FileList | File[]) {
    const toAdd: AttachState[] = [];
    for (const f of Array.from(incoming)) {
      if (f.size > MAX_ATTACH_BYTES) continue;
      const mime = effectiveAttachMime(f);
      if (!ALLOWED_ATTACH_TYPES.has(mime) && !mime.startsWith("text/")) continue;
      const localKey = `${f.name}__${f.size}`;
      if (attachedFiles.some((x) => x.localKey === localKey)) continue;
      toAdd.push({ localKey, file: f, filename: f.name, mime_type: mime, byte_size: f.size, status: "uploading" });
    }
    // Enforce max attachment count
    const remaining = MAX_ATTACH_COUNT - attachedFiles.length;
    if (remaining <= 0 || toAdd.length === 0) return;
    if (toAdd.length > remaining) toAdd.splice(remaining);
    setAttachedFiles((prev) => [...prev, ...toAdd]);
    // Trigger uploads immediately
    for (const entry of toAdd) triggerUpload(entry);
  }

  const isUploading = attachedFiles.some((a) => a.status === "uploading");

  const handleSend = () => {
    if (!inputText.trim() || isLoading || isUploading) return;
    const ready = attachedFiles.filter((a) => a.id).map((a) => ({
      id: a.id!,
      filename: a.filename,
      mime_type: a.mime_type,
      status: a.status as "ready" | "failed",
    }));
    onSend(inputText, ready.length > 0 ? ready : undefined);
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
              {msg.role === "agent" && (
                <div className={styles.messageHeader}>
                  <span className={styles.senderName}>
                    {msg.agentType === "prd"
                      ? "Document Agent"
                      : msg.agentType === "system"
                        ? "System"
                        : msg.agentType === "discussion"
                          ? "Assistant"
                          : "Product AI"}
                  </span>
                </div>
              )}
              <div className={styles.messageText}>
                {msg.role === "agent" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>

              {msg.attachments && msg.attachments.length > 0 && (
                <div className={styles.attachmentChips}>
                  {msg.attachments.map((att) => (
                    <span
                      key={att.id}
                      className={`${styles.attachmentChip} ${att.status === "failed" ? styles.attachmentChipFailed : ""}`}
                      title={att.filename}
                    >
                      <span className={styles.attachmentChipIcon}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48" />
                          </svg>
                        </span>
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
        <div ref={bottomRef} />
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
              disabled={isLoading || attachedFiles.length >= MAX_ATTACH_COUNT}
              aria-label="Attach file"
              title={attachedFiles.length >= MAX_ATTACH_COUNT ? `Max ${MAX_ATTACH_COUNT} files` : "Attach file"}
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
                  {attachedFiles.map((a) => (
                    <span
                      key={a.localKey}
                      className={`${styles.composerChip} ${a.status === "failed" ? styles.composerChipFailed : ""}`}
                    >
                      {a.status === "uploading" ? (
                        <svg className={styles.composerChipSpinner} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                      ) : (
                        <span className={styles.composerChipIcon}>
                          {a.status === "failed" ? "✕" : "✓"}
                        </span>
                      )}
                      <span className={styles.composerChipName}>
                        {a.filename.length > 20 ? a.filename.slice(0, 18) + "…" : a.filename}
                      </span>
                      <span className={styles.composerChipSize}>{formatAttachBytes(a.byte_size)}</span>
                      <button
                        type="button"
                        className={styles.composerChipRemove}
                        onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.localKey !== a.localKey))}
                        aria-label={`Remove ${a.filename}`}
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
                  <button className={styles.sendBtn} onClick={handleSend} disabled={!inputText.trim() || isUploading} type="button">
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
