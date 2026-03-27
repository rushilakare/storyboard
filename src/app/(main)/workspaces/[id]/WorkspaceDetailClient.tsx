"use client";

import {
  useState,
  useEffect,
  use,
  useRef,
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import styles from "./page.module.css";
import NewFeatureModal from "@/components/NewFeatureModal";
import ChatInterface, { Message } from "@/components/ChatInterface";
import PrdRecoveryBanner from "@/components/PrdRecoveryBanner";
import PrdDocumentEditor from "@/components/PrdDocumentEditor";
import { ArtifactListExportSplitButton } from "@/components/DocumentExportSplitButton";
import FeatureArtifactsPanel from "@/components/artifacts/FeatureArtifactsPanel";
import FeatureIssuesPanel from "@/components/issues/FeatureIssuesPanel";
import { buildArtifactFilename, downloadMarkdownFile } from "@/lib/artifactExport";
import { deriveDocumentTitle } from "@/lib/deriveDocumentTitle";
import { X } from "lucide-react";
import type { ClarificationAnswers, ClarifyingQuestion } from "@/lib/postInferenceQuestions";
import {
  formatClarificationSummary,
  parseInferenceStreamComplete,
  splitInferenceDisplayBuffer,
} from "@/lib/postInferenceQuestions";
import {
  formatKnowledgeBaseChatNote,
  parseKnowledgeBaseFromHeaders,
} from "@/lib/knowledge/chatNotice";

/** Chat shows a stub; full text lives in the document panel and in persisted messages. */
const INFERENCE_CHAT_STUB =
  "Feature inference is ready. Use “View feature inference” to read it in the document panel, then approve to continue.";
const COMPETITOR_CHAT_STUB =
  "Competitor analysis is ready. Use “View competitor analysis” in the document panel, then approve to plan backlog issues.";
const ISSUES_PROMPT_CHAT =
  "Feature inference and competitor analysis are complete. When you're ready, generate an epic and backlog issues from this work.";

function appendKnowledgeBaseChatLine(addMessage: (msg: Message) => void, res: Response) {
  if (!res.ok) return;
  const meta = parseKnowledgeBaseFromHeaders(res.headers);
  const note = meta ? formatKnowledgeBaseChatNote(meta) : null;
  if (!note) return;
  addMessage({
    id: `${Date.now()}-kb-${Math.random().toString(36).slice(2, 9)}`,
    role: "agent",
    agentType: "system",
    content: note,
    status: "done",
  });
}

type DocumentPanelKind = "inference" | "competitor" | "prd";

function narrativeFromPersistedInference(content: string): string {
  if (content.includes("<<<CLARIFYING_QUESTIONS_JSON>>>")) {
    return parseInferenceStreamComplete(content).narrative;
  }
  return content;
}

function isLikelyFullInferenceBody(content: string): boolean {
  if (content === INFERENCE_CHAT_STUB) return false;
  return content.length > 160 || content.includes("<<<CLARIFYING_QUESTIONS_JSON>>>");
}

function isLikelyFullCompetitorBody(content: string): boolean {
  if (content === COMPETITOR_CHAT_STUB) return false;
  return content.length > 160;
}

/** Last inference/competitor in the thread — used when the latest bubble is system/issues_prompt/prd/discussion. */
function resolveRevisionAgent(messages: Message[]): "inference" | "competitor" {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "agent" || !m.agentType) continue;
    if (
      m.agentType === "system" ||
      m.agentType === "discussion" ||
      m.agentType === "issues_prompt" ||
      m.agentType === "prd"
    ) {
      continue;
    }
    if (m.agentType === "inference" || m.agentType === "competitor") return m.agentType;
  }
  return "inference";
}

type ConsumeInferenceStreamOptions = {
  /** Keep the inference panel empty until the stream completes (no partial draft). */
  bufferDocumentUntilDone?: boolean;
  /** For persisted features, clarifying Q&A is only the pre-inference modal — ignore model JSON appendix. */
  dropParsedQuestions?: boolean;
};

async function consumeInferenceStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  agentMsgId: string,
  setMessages: Dispatch<SetStateAction<Message[]>>,
  setInferenceDoc: Dispatch<SetStateAction<string>>,
  options?: ConsumeInferenceStreamOptions,
): Promise<{ narrative: string; questions: ClarifyingQuestion[] }> {
  const bufferDocumentUntilDone = options?.bufferDocumentUntilDone ?? false;
  const dropParsedQuestions = options?.dropParsedQuestions ?? false;
  const decoder = new TextDecoder();
  let agentContent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    agentContent += decoder.decode(value, { stream: true });
    if (!bufferDocumentUntilDone) {
      const { display } = splitInferenceDisplayBuffer(agentContent);
      setInferenceDoc(display);
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId ? { ...m, content: "Generating feature inference…" } : m,
      ),
    );
  }
  const { narrative, questions: parsedQs } = parseInferenceStreamComplete(agentContent);
  const questions = dropParsedQuestions ? [] : parsedQs;
  setInferenceDoc(narrative);
  setMessages((prev) =>
    prev.map((m) =>
      m.id === agentMsgId
        ? {
            ...m,
            content: INFERENCE_CHAT_STUB,
            ...(questions.length > 0 ? { clarifyingQuestions: questions } : {}),
            status: "needs_review" as const,
          }
        : m,
    ),
  );
  return { narrative, questions };
}

async function streamCompetitorToDocument(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  agentMsgId: string,
  setMessages: Dispatch<SetStateAction<Message[]>>,
  setCompetitorDoc: Dispatch<SetStateAction<string>>,
): Promise<string> {
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    setCompetitorDoc(full);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId ? { ...m, content: "Generating competitor analysis…" } : m,
      ),
    );
  }
  setMessages((prev) =>
    prev.map((m) =>
      m.id === agentMsgId
        ? { ...m, content: COMPETITOR_CHAT_STUB, status: "needs_review" as const }
        : m,
    ),
  );
  return full;
}

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
}

interface FeatureRow {
  id: string;
  name: string;
  status: string;
  priority: string;
  purpose: string | null;
  updated_at: string;
}

function prdContentFromFeature(data: { prd_documents?: unknown }): string {
  const docs = data.prd_documents;
  if (Array.isArray(docs) && docs[0] && typeof docs[0] === "object" && "content" in docs[0]) {
    return String((docs[0] as { content: string }).content ?? "");
  }
  if (docs && typeof docs === "object" && "content" in docs) {
    return String((docs as { content: string }).content ?? "");
  }
  return "";
}

const PRD_AUTOSAVE_MS = 3000;
const PRD_AUTOSAVE_CHARS = 2000;

async function postBeginPrdDraft(fid: string): Promise<void> {
  const res = await fetch(`/api/features/${fid}/prd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ beginDraft: true }),
  });
  if (!res.ok) {
    console.error("beginPrdDraft failed", res.status, await res.text());
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "review":
      return "Review";
    case "generating":
      return "Generating PRD";
    case "done":
      return "Done";
    default:
      return "Draft";
  }
}

function listTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function workspaceArtifactKindLabel(kind: string) {
  switch (kind) {
    case "prd":
      return "PRD";
    case "inference":
      return "Inference";
    case "competitor":
      return "Competitors";
    default:
      return kind;
  }
}

function panelKindFallbackLabel(kind: DocumentPanelKind): string {
  if (kind === "prd") return "PRD";
  if (kind === "inference") return "Feature inference";
  return "Competitor analysis";
}

interface WorkspaceArtifactRow {
  id: string;
  feature_id: string;
  kind: string;
  title: string | null;
  version: number;
  updated_at: string;
  created_at: string;
  feature_name: string | null;
  workspace_id: string;
}

export default function WorkspaceDetailClient({ params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const featureParam = searchParams.get("feature");
  const listViewArtifacts = searchParams.get("view") === "artifacts";
  const panelIssues = searchParams.get("panel") === "issues";
  const panelArtifacts = searchParams.get("panel") === "artifacts";
  const artifactParam = searchParams.get("artifact");

  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [featuresList, setFeaturesList] = useState<FeatureRow[]>([]);
  const [listLoading, setListLoading] = useState(!featureParam && !listViewArtifacts);
  const [listError, setListError] = useState<string | null>(null);
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<WorkspaceArtifactRow[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(!featureParam && listViewArtifacts);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [featureListSearch, setFeatureListSearch] = useState("");
  const [artifactListSearch, setArtifactListSearch] = useState("");
  const debouncedFeatureListSearch = useDebouncedValue(featureListSearch, 250);
  const debouncedArtifactListSearch = useDebouncedValue(artifactListSearch, 250);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [featureData, setFeatureData] = useState<{
    name: string;
    purpose: string;
    requirements: string;
  } | null>(null);
  const [prdDocument, setPrdDocument] = useState<string>("");
  const [inferenceDocument, setInferenceDocument] = useState<string>("");
  const [competitorDocument, setCompetitorDocument] = useState<string>("");
  const [documentPanelKind, setDocumentPanelKind] = useState<DocumentPanelKind>("prd");
  const [featureId, setFeatureId] = useState<string | null>(null);
  const [savingPrd, setSavingPrd] = useState(false);
  const [savedPrd, setSavedPrd] = useState(false);
  const [clarifyingOpen, setClarifyingOpen] = useState(false);
  const [pendingClarifyingQuestions, setPendingClarifyingQuestions] = useState<ClarifyingQuestion[]>([]);
  const [inferenceReviseHint, setInferenceReviseHint] = useState(false);
  const [focusComposerToken, setFocusComposerToken] = useState(0);
  const [featureStatus, setFeatureStatus] = useState<string | null>(null);
  const [prdRecoveryPromptOpen, setPrdRecoveryPromptOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [launchIssuesGenerateToken, setLaunchIssuesGenerateToken] = useState(0);
  const [artifactsHeaderMeta, setArtifactsHeaderMeta] = useState<{
    kind: string;
    title: string;
  } | null>(null);
  /** After issues are saved once, composer uses backlog discussion API instead of infer/competitor. */
  const [discussionMode, setDiscussionMode] = useState(false);
  /** Clarifying modal is the pre-inference Q&A step (not post-stream JSON questions). */
  const [clarifyingIsPreInference, setClarifyingIsPreInference] = useState(false);
  const [featureCreateError, setFeatureCreateError] = useState<string | null>(null);
  const [preInferenceQuestionsError, setPreInferenceQuestionsError] = useState<string | null>(null);

  const clearPanelSearchParams = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("panel");
    p.delete("artifact");
    if (featureParam) p.set("feature", featureParam);
    router.replace(`/workspaces/${workspaceId}?${p.toString()}`);
    setArtifactsHeaderMeta(null);
  }, [router, workspaceId, searchParams, featureParam]);

  const closeRightPane = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("panel");
    p.delete("artifact");
    if (featureParam) p.set("feature", featureParam);
    router.push(`/workspaces/${workspaceId}?${p.toString()}`);
    setIsSplitView(false);
    setArtifactsHeaderMeta(null);
  }, [router, workspaceId, searchParams, featureParam]);

  const openIssuesPanel = useCallback(() => {
    if (!featureParam) return;
    if (documentPanelKind === "prd" && prdContentDirtyRef.current) {
      if (!window.confirm("Discard unsaved PRD changes and open Issues?")) return;
    }
    const p = new URLSearchParams(searchParams.toString());
    p.set("feature", featureParam);
    p.set("panel", "issues");
    p.delete("artifact");
    router.push(`/workspaces/${workspaceId}?${p.toString()}`);
    setIsSplitView(true);
    setArtifactsHeaderMeta(null);
  }, [featureParam, router, workspaceId, searchParams, documentPanelKind]);

  const handleLaunchGenerateConsumed = useCallback(() => {
    setLaunchIssuesGenerateToken(0);
  }, []);

  const openArtifactsPanel = useCallback(() => {
    if (!featureParam) return;
    if (documentPanelKind === "prd" && prdContentDirtyRef.current) {
      if (!window.confirm("Discard unsaved PRD changes and open Artifacts?")) return;
    }
    const p = new URLSearchParams(searchParams.toString());
    p.set("feature", featureParam);
    p.set("panel", "artifacts");
    p.delete("artifact");
    router.push(`/workspaces/${workspaceId}?${p.toString()}`);
    setIsSplitView(true);
    setArtifactsHeaderMeta(null);
  }, [featureParam, router, workspaceId, searchParams, documentPanelKind]);

  const streamingRef = useRef(false);
  const prdContentDirtyRef = useRef(false);
  const featureIdRef = useRef<string | null>(null);
  const prdStreamingBufferRef = useRef<string>("");
  // Tracks which inference message IDs already triggered the clarifying modal
  const clarifyShownForRef = useRef<Set<string>>(new Set());
  const preInferenceClarifyPendingRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    featureIdRef.current = featureId;
  }, [featureId]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!streamingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
      const fid = featureIdRef.current;
      const buf = prdStreamingBufferRef.current;
      if (typeof navigator !== "undefined" && fid && buf.length > 0) {
        const url = `${window.location.origin}/api/features/${fid}/prd`;
        const blob = new Blob([JSON.stringify({ content: buf })], {
          type: "application/json",
        });
        navigator.sendBeacon(url, blob);
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const addMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  };

  const persistMessage = useCallback(
    async (
      fid: string,
      role: "user" | "assistant" | "system",
      content: string,
      agentType?: string | null,
      metadata?: Record<string, unknown> | null,
    ): Promise<string | undefined> => {
      try {
        const res = await fetch(`/api/features/${fid}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            content,
            agent_type: agentType ?? null,
            metadata:
              metadata && Object.keys(metadata).length > 0 ? metadata : {},
          }),
        });
        if (!res.ok) {
          const t = await res.text();
          console.error("Failed to persist message", res.status, t);
          return undefined;
        }
        const data = (await res.json()) as { id?: string };
        return typeof data.id === "string" ? data.id : undefined;
      } catch (e) {
        console.error("Failed to persist message", e);
        return undefined;
      }
    },
    [],
  );

  const chatComposerPlaceholder = useMemo(() => {
    if (discussionMode) {
      return "Ask about this backlog, tradeoffs, or next steps…";
    }
    if (featureStatus === "done") {
      return "Describe changes to inference or competitor. Open Issues → Regenerate to replace generated backlog.";
    }
    return undefined;
  }, [featureStatus, discussionMode]);

  const handleIssuesCommitted = useCallback(() => {
    setDiscussionMode(true);
    const line =
      "Issues saved. To replace them with a new AI draft, open the Issues panel and click Regenerate.";
    const id = `${Date.now()}-sys-issues-saved`;
    setMessages((prev) => [
      ...prev,
      {
        id,
        role: "agent",
        agentType: "system",
        content: line,
        status: "done",
      },
    ]);
    const fid = featureId;
    if (fid) void persistMessage(fid, "system", line, "system");
  }, [featureId, persistMessage]);

  const finalizePrdAndPersistAssistant = useCallback(
    async (fid: string, fullMarkdown: string) => {
      const putRes = await fetch(`/api/features/${fid}/prd`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fullMarkdown, finalize: true }),
      });
      let artifactId: string | undefined;
      let version: number | undefined;
      if (putRes.ok) {
        try {
          const j = (await putRes.json()) as { id?: string; version?: number };
          if (typeof j.id === "string") artifactId = j.id;
          if (typeof j.version === "number") version = j.version;
        } catch {
          /* ignore */
        }
      } else {
        console.error("finalize PRD failed", putRes.status, await putRes.text());
      }

      const line =
        version !== undefined
          ? `The PRD is ready for review (version ${version}). Click below to view the document.`
          : "The PRD is ready for review. Click below to view the document.";
      const meta =
        artifactId && version !== undefined
          ? { artifact_ids: [artifactId], artifact_version: version }
          : undefined;
      const msgId = await persistMessage(fid, "assistant", line, "prd", meta);
      if (msgId && artifactId) {
        try {
          await fetch(`/api/features/${fid}/artifacts/${artifactId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_message_id: msgId }),
          });
        } catch {
          /* ignore */
        }
      }
    },
    [persistMessage],
  );

  const consumePrdStream = useCallback(
    async (
      res: Response,
      fid: string | null,
      partialPrefix: string,
      setDoc: (s: string) => void,
    ): Promise<string> => {
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || res.statusText || "Request failed");
      }
      if (!res.body) {
        throw new Error("No response body");
      }

      let continuation = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lastSaveAt = Date.now();
      let lastSaveLen = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        continuation += decoder.decode(value, { stream: true });
        const full = partialPrefix + continuation;
        prdStreamingBufferRef.current = full;
        setDoc(full);

        if (fid && full.length > 0) {
          const now = Date.now();
          if (
            now - lastSaveAt >= PRD_AUTOSAVE_MS ||
            full.length - lastSaveLen >= PRD_AUTOSAVE_CHARS
          ) {
            lastSaveAt = now;
            lastSaveLen = full.length;
            void fetch(`/api/features/${fid}/prd`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: full }),
            }).catch(() => {});
          }
        }
      }

      return partialPrefix + continuation;
    },
    [],
  );

  // Load workspace info
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}`);
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setWorkspace({
          id: data.id,
          name: data.name,
          description: data.description ?? null,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Load feature list or workspace artifacts (when no feature is selected)
  useEffect(() => {
    if (featureParam) {
      setListLoading(false);
      setArtifactsLoading(false);
      return;
    }

    let cancelled = false;

    if (listViewArtifacts) {
      setListLoading(false);
      setArtifactsLoading(true);
      setArtifactsError(null);
      (async () => {
        try {
          const aq = debouncedArtifactListSearch.trim();
          const artifactQs = aq
            ? `?q=${encodeURIComponent(aq)}`
            : "";
          const res = await fetch(
            `/api/workspaces/${workspaceId}/artifacts${artifactQs}`,
          );
          const data = await res.json();
          if (cancelled) return;
          if (!res.ok) {
            setArtifactsError(
              typeof data?.error === "string" ? data.error : "Failed to load artifacts",
            );
            setWorkspaceArtifacts([]);
            return;
          }
          setWorkspaceArtifacts(Array.isArray(data) ? data : []);
        } catch {
          if (!cancelled) setArtifactsError("Network error loading artifacts.");
        } finally {
          if (!cancelled) setArtifactsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setArtifactsLoading(false);
    setListLoading(true);
    setListError(null);
    (async () => {
      try {
        const fq = debouncedFeatureListSearch.trim();
        const featureQs = fq
          ? `&q=${encodeURIComponent(fq)}`
          : "";
        const res = await fetch(
          `/api/features?workspaceId=${encodeURIComponent(workspaceId)}${featureQs}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setListError(typeof data?.error === "string" ? data.error : "Failed to load features");
          setFeaturesList([]);
          return;
        }
        setFeaturesList(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setListError("Network error loading features.");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    workspaceId,
    featureParam,
    listViewArtifacts,
    debouncedFeatureListSearch,
    debouncedArtifactListSearch,
  ]);

  // Reset UI state when navigating back to list
  useEffect(() => {
    if (featureParam) return;
    setMessages([]);
    setFeatureData(null);
    setFeatureId(null);
    setPrdDocument("");
    setInferenceDocument("");
    setCompetitorDocument("");
    setDocumentPanelKind("prd");
    setFeatureStatus(null);
    setPrdRecoveryPromptOpen(false);
    setStreamError(null);
    setChatStarted(false);
    setIsSplitView(false);
    setSavedPrd(false);
    prdContentDirtyRef.current = false;
    setIsModalOpen(false);
    setClarifyingOpen(false);
    setPendingClarifyingQuestions([]);
    setDiscussionMode(false);
    setClarifyingIsPreInference(false);
    preInferenceClarifyPendingRef.current = false;
    setFeatureCreateError(null);
    setPreInferenceQuestionsError(null);
  }, [featureParam]);

  const openClarifyingModal = useCallback((inferMsgId: string) => {
    if (clarifyShownForRef.current.has(inferMsgId)) return;
    clarifyShownForRef.current.add(inferMsgId);
    setClarifyingOpen(true);
  }, []);

  const runInitialInference = useCallback(
    async (
      fid: string | null,
      form: { name: string; purpose: string; requirements: string },
      opts?: { mode?: "fresh" | "after_clarify_revise" },
    ) => {
      const mode = opts?.mode ?? "fresh";
      if (mode === "after_clarify_revise") {
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "agent" && m.agentType === "inference" && m.status === "needs_review"
              ? { ...m, status: "done" as const }
              : m,
          ),
        );
      }

      const agentMsgId = `${Date.now()}-agent`;
      setInferenceDocument("");
      if (mode === "fresh") {
        setCompetitorDocument("");
      }
      setDocumentPanelKind("inference");
      setIsSplitView(true);
      addMessage({
        id: agentMsgId,
        role: "agent",
        agentType: "inference",
        content: "Generating feature inference…",
        status: "pending",
      });

      streamingRef.current = true;
      setIsLoading(true);
      let narrativeForPersistence = "";
      let parsedQuestions: ClarifyingQuestion[] = [];
      try {
        const res = await fetch("/api/agents/infer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featureId: fid, ...form }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error("Inference failed", err);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId
                ? { ...m, content: `Error: ${err || res.statusText}`, status: "needs_review" }
                : m,
            ),
          );
        } else {
          appendKnowledgeBaseChatLine(addMessage, res);
          if (res.body) {
            const reader = res.body.getReader();
            const streamOpts: ConsumeInferenceStreamOptions | undefined = fid
              ? { bufferDocumentUntilDone: true, dropParsedQuestions: true }
              : undefined;
            const { narrative, questions } = await consumeInferenceStream(
              reader,
              agentMsgId,
              setMessages,
              setInferenceDocument,
              streamOpts,
            );
            narrativeForPersistence = narrative;
            parsedQuestions = questions;
            if (!fid && questions.length > 0) {
              setPendingClarifyingQuestions(questions);
              openClarifyingModal(agentMsgId);
            } else {
              setPendingClarifyingQuestions([]);
            }
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        streamingRef.current = false;
        setIsLoading(false);
      }

      if (fid && narrativeForPersistence) {
        const meta =
          !fid && parsedQuestions.length > 0
            ? { clarifying_questions: parsedQuestions }
            : undefined;
        await persistMessage(fid, "assistant", narrativeForPersistence, "inference", meta);
      }
    },
    [persistMessage, openClarifyingModal],
  );

  useEffect(() => {
    clarifyShownForRef.current.clear();
  }, [featureParam]);

  useEffect(() => {
    if (featureParam && (panelIssues || panelArtifacts)) {
      setIsSplitView(true);
    }
  }, [featureParam, panelIssues, panelArtifacts]);

  // Hydrate feature + persisted messages from DB
  useEffect(() => {
    if (!featureParam) return;
    if (streamingRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const [featureRes, msgsRes] = await Promise.all([
          fetch(`/api/features/${featureParam}`),
          fetch(`/api/features/${featureParam}/messages`),
        ]);
        const data = await featureRes.json();
        const dbMsgs = await msgsRes.json();
        if (cancelled) return;
        if (!featureRes.ok || data.workspace_id !== workspaceId) {
          router.replace(`/workspaces/${workspaceId}`);
          return;
        }

        const purpose = data.purpose ?? "";
        const requirements = data.requirements ?? "";
        setFeatureData({ name: data.name, purpose, requirements });
        setFeatureId(data.id);
        setFeatureStatus(typeof data.status === "string" ? data.status : null);

        const prdText = prdContentFromFeature(data);
        setPrdDocument(prdText);

        if (data.status === "generating") {
          setDocumentPanelKind("prd");
          setPrdRecoveryPromptOpen(true);
          setIsSplitView(true);
        } else {
          setPrdRecoveryPromptOpen(false);
        }

        if (Array.isArray(dbMsgs) && dbMsgs.length > 0) {
          const rawUiMsgs: Message[] = dbMsgs.map((m: Record<string, unknown>) => {
            const meta = m.metadata as Record<string, unknown> | undefined;
            let clarifyingQuestions: ClarifyingQuestion[] | undefined;
            const rawQ = meta?.clarifying_questions;
            if (Array.isArray(rawQ) && rawQ.length > 0) {
              clarifyingQuestions = rawQ as ClarifyingQuestion[];
            }
            return {
              id: m.id as string,
              role: (m.role === "user" ? "user" : "agent") as "user" | "agent",
              agentType: (m.agent_type as Message["agentType"]) || undefined,
              content: m.content as string,
              status: "done" as const,
              clarifyingQuestions,
            };
          });

          let extractedInference = "";
          let extractedCompetitor = "";
          const uiMsgs = rawUiMsgs.map((m) => {
            if (m.role === "agent" && m.agentType === "inference" && isLikelyFullInferenceBody(m.content)) {
              extractedInference = narrativeFromPersistedInference(m.content);
              return { ...m, content: INFERENCE_CHAT_STUB };
            }
            if (m.role === "agent" && m.agentType === "competitor" && isLikelyFullCompetitorBody(m.content)) {
              extractedCompetitor = m.content;
              return { ...m, content: COMPETITOR_CHAT_STUB };
            }
            return m;
          });

          setInferenceDocument(extractedInference);
          setCompetitorDocument(extractedCompetitor);

          // Mark last non-system agent message as needs_review when appropriate
          const lastAgentIdx = [...uiMsgs]
            .reverse()
            .findIndex((m) => m.role === "agent" && m.agentType !== "system");
          if (lastAgentIdx >= 0) {
            const realIdx = uiMsgs.length - 1 - lastAgentIdx;
            const lastAgent = uiMsgs[realIdx];
            const needsReview =
              (data.status === "draft" && lastAgent.agentType === "inference") ||
              (data.status === "in_progress" && lastAgent.agentType === "competitor") ||
              (data.status === "review" && lastAgent.agentType === "issues_prompt");
            if (needsReview) {
              uiMsgs[realIdx] = { ...lastAgent, status: "needs_review" };
            }
          }

          setMessages(uiMsgs);

          if (["review", "done"].includes(data.status) && prdText) {
            setDocumentPanelKind("prd");
            setIsSplitView(true);
          } else if (
            data.status === "review" &&
            uiMsgs.some(
              (m) =>
                m.role === "agent" &&
                m.agentType === "issues_prompt" &&
                m.status === "needs_review",
            )
          ) {
            setDocumentPanelKind("competitor");
            setIsSplitView(true);
          } else if (data.status === "draft") {
            const hasInf = uiMsgs.some(
              (m) =>
                m.role === "agent" && m.agentType === "inference" && m.status === "needs_review",
            );
            if (hasInf) {
              setDocumentPanelKind("inference");
              setIsSplitView(true);
            }
          } else if (data.status === "in_progress") {
            const hasComp = uiMsgs.some(
              (m) =>
                m.role === "agent" && m.agentType === "competitor" && m.status === "needs_review",
            );
            if (hasComp) {
              setDocumentPanelKind("competitor");
              setIsSplitView(true);
            }
          }
        } else {
          // No persisted messages — show synthetic placeholder (backward compat)
          const summary = `I want a new feature: ${data.name}\n\nPurpose: ${purpose}\nRequirements: ${requirements}`;
          const userMsg: Message = {
            id: `loaded-user-${data.id}`,
            role: "user",
            content: summary,
          };

          if (data.status === "draft") {
            setMessages([
              userMsg,
              {
                id: `loaded-inf-${data.id}`,
                role: "agent",
                agentType: "inference",
                content: "Loaded from workspace. Approve to continue, or send a message to refine.",
                status: "needs_review",
              },
            ]);
          } else if (data.status === "in_progress") {
            setMessages([
              userMsg,
              {
                id: `loaded-comp-${data.id}`,
                role: "agent",
                agentType: "competitor",
                content: "Loaded from workspace. Approve to plan backlog issues, or revise.",
                status: "needs_review",
              },
            ]);
          } else if (data.status === "generating") {
            setMessages([
              userMsg,
              {
                id: `loaded-gen-${data.id}`,
                role: "agent",
                agentType: "prd",
                content:
                  "PRD generation was interrupted or is still in progress. Use the recovery options in the PRD editor panel.",
                status: "done",
              },
            ]);
            setIsSplitView(true);
          } else {
            setMessages([
              userMsg,
              {
                id: `loaded-prd-${data.id}`,
                role: "agent",
                agentType: "prd",
                content: "PRD loaded. Edit in the panel or send revisions.",
                status: "done",
              },
            ]);
            if (prdText) setIsSplitView(true);
          }
        }

        prdContentDirtyRef.current = false;
        setChatStarted(true);
        setIsModalOpen(false);
      } catch {
        if (!cancelled) router.replace(`/workspaces/${workspaceId}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [featureParam, workspaceId, router]);

  const fetchPreInferenceQuestions = useCallback(
    async (
      fid: string,
      form: { name: string; purpose: string; requirements: string },
    ): Promise<{ ok: true; questions: ClarifyingQuestion[] } | { ok: false; error: string }> => {
      try {
        const qres = await fetch("/api/agents/infer-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            featureId: fid,
            name: form.name,
            purpose: form.purpose,
            requirements: form.requirements,
          }),
        });
        if (!qres.ok) {
          const errText = await qres.text().catch(() => "");
          return {
            ok: false,
            error: errText || qres.statusText || "Could not load clarifying questions.",
          };
        }
        const j = (await qres.json()) as { questions?: ClarifyingQuestion[]; error?: string };
        if (Array.isArray(j.questions) && j.questions.length > 0) {
          return { ok: true, questions: j.questions };
        }
        return {
          ok: false,
          error: j.error || "The questions service returned no questions. Try again.",
        };
      } catch (e) {
        console.error("infer-questions failed", e);
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Network error loading clarifying questions.",
        };
      }
    },
    [],
  );

  const retryPreInferenceQuestions = useCallback(async () => {
    const fid = featureId;
    const fd = featureData;
    if (!fid || !fd) return;
    setPreInferenceQuestionsError(null);
    setIsLoading(true);
    streamingRef.current = true;
    try {
      const result = await fetchPreInferenceQuestions(fid, fd);
      if (result.ok) {
        preInferenceClarifyPendingRef.current = true;
        setClarifyingIsPreInference(true);
        clarifyShownForRef.current.add(`pre-${fid}`);
        setPendingClarifyingQuestions(result.questions);
        setClarifyingOpen(true);
        return;
      }
      setPreInferenceQuestionsError(result.error);
    } finally {
      setIsLoading(false);
      streamingRef.current = false;
    }
  }, [featureId, featureData, fetchPreInferenceQuestions]);

  // ── New Feature Flow ──────────────────────────────────────────────
  const handleStartFeature = async (data: {
    name: string;
    purpose: string;
    requirements: string;
  }) => {
    setFeatureCreateError(null);
    setPreInferenceQuestionsError(null);
    setFeatureData(data);
    setIsLoading(true);

    let newId: string | null = null;
    try {
      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          purpose: data.purpose,
          requirements: data.requirements,
          workspace_id: workspaceId,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        setFeatureCreateError(errText || res.statusText || "Could not create feature.");
        setIsLoading(false);
        return;
      }
      const saved = await res.json();
      newId = saved.id;
      setFeatureId(saved.id);
    } catch (e) {
      console.error("Failed to persist feature", e);
      setFeatureCreateError(e instanceof Error ? e.message : "Could not create feature.");
      setIsLoading(false);
      return;
    }

    if (!newId) {
      setIsLoading(false);
      return;
    }

    const createdFeatureId = newId;

    setIsModalOpen(false);
    setChatStarted(true);
    streamingRef.current = true;
    router.replace(`/workspaces/${workspaceId}?feature=${createdFeatureId}`);

    const userContent = `I want a new feature: ${data.name}\n\nPurpose: ${data.purpose}\nRequirements: ${data.requirements}`;
    addMessage({ id: Date.now().toString(), role: "user", content: userContent });
    await persistMessage(createdFeatureId, "user", userContent);

    const qResult = await fetchPreInferenceQuestions(createdFeatureId, data);
    setIsLoading(false);
    streamingRef.current = false;

    if (qResult.ok) {
      preInferenceClarifyPendingRef.current = true;
      setClarifyingIsPreInference(true);
      clarifyShownForRef.current.add(`pre-${createdFeatureId}`);
      setPendingClarifyingQuestions(qResult.questions);
      setClarifyingOpen(true);
      return;
    }

    setPreInferenceQuestionsError(qResult.error);
  };

  // ── User Revision ─────────────────────────────────────────────────
  const handleSend = async (text: string) => {
    const lastAgentMsg = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === "agent" && m.agentType !== "system");

    if (lastAgentMsg?.agentType === "issues_prompt" && lastAgentMsg.status === "needs_review") {
      return;
    }
    if (lastAgentMsg?.agentType === "prd") {
      return;
    }

    const fidDiscuss = featureId;
    if (discussionMode && fidDiscuss) {
      const userId = `${Date.now()}-user`;
      const agentId = `${Date.now()}-discuss`;
      addMessage({ id: userId, role: "user", content: text });
      await persistMessage(fidDiscuss, "user", text);
      addMessage({
        id: agentId,
        role: "agent",
        agentType: "discussion",
        content: "Thinking…",
        status: "pending",
      });
      setIsLoading(true);
      try {
        const res = await fetch(`/api/features/${fidDiscuss}/discuss`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const body = await res.json().catch(() => ({}));
        const reply =
          typeof (body as { reply?: string }).reply === "string"
            ? (body as { reply: string }).reply
            : `Error: ${typeof (body as { error?: string }).error === "string" ? (body as { error: string }).error : res.statusText}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId
              ? { ...m, content: reply, status: "done" as const }
              : m,
          ),
        );
        if (res.ok) {
          await persistMessage(fidDiscuss, "assistant", reply, "discussion");
        }
      } catch (e) {
        console.error(e);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId
              ? {
                  ...m,
                  content: e instanceof Error ? e.message : "Discussion request failed",
                  status: "done" as const,
                }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const agentType = resolveRevisionAgent(messagesRef.current);
    const endpoint = agentType === "competitor" ? "/api/agents/competitor" : "/api/agents/infer";

    const isPrd = false; /* was: endpoint === "/api/agents/prd" — PRD stream from composer disabled */
    const agentMsgId = Date.now().toString() + "-agent";

    setInferenceReviseHint(false);

    if (!isPrd && agentType === "inference") {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "agent" && m.agentType === "inference" && m.status === "needs_review"
            ? { ...m, status: "done" as const }
            : m,
        ),
      );
    } else if (!isPrd && agentType === "competitor") {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "agent" && m.agentType === "competitor" && m.status === "needs_review"
            ? { ...m, status: "done" as const }
            : m,
        ),
      );
    }

    addMessage({ id: Date.now().toString(), role: "user", content: text });

    const fid = featureId;
    if (fid) {
      await persistMessage(fid, "user", text);
    }

    if (!isPrd) {
      if (agentType === "inference") {
        setDocumentPanelKind("inference");
        setIsSplitView(true);
        setInferenceDocument("");
      } else if (agentType === "competitor") {
        setDocumentPanelKind("competitor");
        setIsSplitView(true);
        setCompetitorDocument("");
      }
      addMessage({
        id: agentMsgId,
        role: "agent",
        agentType: agentType,
        content:
          agentType === "inference"
            ? "Generating feature inference…"
            : "Generating competitor analysis…",
        status: "pending",
      });
    }

    streamingRef.current = true;
    setIsLoading(true);
    let agentContent = "";
    /* PRD revision branch (disabled)
    if (isPrd) {
      setDocumentPanelKind("prd");
      setIsSplitView(true);
      prdStreamingBufferRef.current = "";
      if (fid) await postBeginPrdDraft(fid);
    }
    */
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ featureId: fid, ...featureData, revision: text }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Agent request failed", err);
        if (!isPrd) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId
                ? { ...m, content: `Error: ${err || res.statusText}`, status: "needs_review" }
                : m,
            ),
          );
        } else {
          setStreamError(err || res.statusText);
        }
      } else if (isPrd) {
        /* disabled
        if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
        agentContent = await consumePrdStream(res, fid, "", setPrdDocument);
        */
      } else {
        if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
        if (res.body) {
          const reader = res.body.getReader();
          if (agentType === "inference") {
            const streamOpts: ConsumeInferenceStreamOptions | undefined = fid
              ? { bufferDocumentUntilDone: true, dropParsedQuestions: true }
              : undefined;
            const { narrative, questions } = await consumeInferenceStream(
              reader,
              agentMsgId,
              setMessages,
              setInferenceDocument,
              streamOpts,
            );
            agentContent = narrative;
            if (!fid && questions.length > 0) {
              setPendingClarifyingQuestions(questions);
              openClarifyingModal(agentMsgId);
            } else {
              setPendingClarifyingQuestions([]);
            }
          } else {
            agentContent = await streamCompetitorToDocument(
              reader,
              agentMsgId,
              setMessages,
              setCompetitorDocument,
            );
          }
        }
      }
    } catch (e) {
      console.error(e);
      if (isPrd) {
        setStreamError(e instanceof Error ? e.message : "Stream failed");
      }
    }

    if (fid && agentContent) {
      if (isPrd) {
        /* disabled
        try {
          await finalizePrdAndPersistAssistant(fid, agentContent);
          prdContentDirtyRef.current = false;
          setSavedPrd(true);
        } catch (pe) {
          console.error("Failed to save PRD after revision", pe);
        }
        */
      } else if (agentType === "inference") {
        await persistMessage(fid, "assistant", agentContent, agentType);
      } else {
        await persistMessage(fid, "assistant", agentContent, agentType);
      }
    }

    if (isPrd) {
      prdStreamingBufferRef.current = "";
    }
    setIsLoading(false);
    streamingRef.current = false;
  };

  // ── Approve + Next Stage ──────────────────────────────────────────
  const handleApprove = async (msgId: string, agentType: string) => {
    setIsLoading(true);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: "done" } : m)),
    );

    const fid = featureId;

    try {
      if (agentType === "inference") {
        if (fid) {
          await fetch(`/api/features/${fid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "in_progress" }),
          });
        }

        const sysContent = "Great! Sending to Competitor Research Agent...";
        addMessage({
          id: Date.now().toString() + "sys",
          role: "agent",
          agentType: "system",
          content: sysContent,
        });
        if (fid) persistMessage(fid, "system", sysContent, "system");

        setCompetitorDocument("");
        setDocumentPanelKind("competitor");
        setIsSplitView(true);

        const compMsgId = Date.now().toString() + "-comp";
        addMessage({
          id: compMsgId,
          role: "agent",
          agentType: "competitor",
          content: "Generating competitor analysis…",
          status: "pending",
        });

        streamingRef.current = true;
        let agentContent = "";
        const res = await fetch("/api/agents/competitor", {
          method: "POST",
          body: JSON.stringify({ featureId: fid, ...featureData }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error("Competitor agent failed", err);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === compMsgId
                ? { ...m, content: `Error: ${err || res.statusText}`, status: "needs_review" }
                : m,
            ),
          );
        } else {
          appendKnowledgeBaseChatLine(addMessage, res);
          if (res.body) {
            const reader = res.body.getReader();
            agentContent = await streamCompetitorToDocument(
              reader,
              compMsgId,
              setMessages,
              setCompetitorDocument,
            );
          }
        }

        if (fid && agentContent) {
          await persistMessage(fid, "assistant", agentContent, "competitor");
        }
        streamingRef.current = false;
      } else if (agentType === "competitor") {
        if (fid) {
          await fetch(`/api/features/${fid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "review" }),
          });
          setFeatureStatus("review");
        }

        setDocumentPanelKind("competitor");
        setIsSplitView(true);

        const sysContent =
          "Feature inference and competitor analysis are saved. When you're ready, generate an epic and backlog issues.";
        addMessage({
          id: Date.now().toString() + "sys",
          role: "agent",
          agentType: "system",
          content: sysContent,
        });
        if (fid) void persistMessage(fid, "system", sysContent, "system");

        const issuesPromptId = Date.now().toString() + "-issues-prompt";
        addMessage({
          id: issuesPromptId,
          role: "agent",
          agentType: "issues_prompt",
          content: ISSUES_PROMPT_CHAT,
          status: "needs_review",
        });
        if (fid) {
          await persistMessage(fid, "assistant", ISSUES_PROMPT_CHAT, "issues_prompt");
        }

        /* PRD auto-run after competitor (disabled to save tokens — use Issues panel instead)
        setDocumentPanelKind("prd");
        const sysContent = "Great! Generating the PRD Document...";
        addMessage({ ... });
        if (fid) {
          await fetch(..., { status: "generating" });
          setFeatureStatus("generating");
          setPrdRecoveryPromptOpen(false);
          await postBeginPrdDraft(fid);
        }
        const prdMsgId = ...;
        addMessage({ agentType: "prd", ... });
        streamingRef.current = true;
        prdStreamingBufferRef.current = "";
        setStreamError(null);
        try {
          const res = await fetch("/api/agents/prd", { method: "POST", body: JSON.stringify({ featureId: fid, ...featureData }) });
          if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
          const agentContent = await consumePrdStream(res, fid, "", setPrdDocument);
          setMessages(...);
          if (fid && agentContent) {
            await finalizePrdAndPersistAssistant(fid, agentContent);
            await fetch(`/api/features/${fid}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
            setFeatureStatus("done");
            prdContentDirtyRef.current = false;
            setSavedPrd(true);
          }
        } catch (e) { ... }
        finally { streamingRef.current = false; prdStreamingBufferRef.current = ""; }
        */
      } else if (agentType === "issues_prompt") {
        if (fid) {
          await fetch(`/api/features/${fid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "done" }),
          });
          setFeatureStatus("done");
        }
        openIssuesPanel();
        setLaunchIssuesGenerateToken((t) => t + 1);
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const handlePrdRecoveryContinue = async () => {
    const fid = featureId;
    if (!fid || !featureData) return;
    setStreamError(null);
    setPrdRecoveryPromptOpen(false);
    const partial = prdDocument;
    streamingRef.current = true;
    setIsLoading(true);
    prdStreamingBufferRef.current = partial;
    try {
      await postBeginPrdDraft(fid);
      const res = await fetch("/api/agents/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureId: fid,
          ...featureData,
          continue: partial,
        }),
      });
      if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
      const agentContent = await consumePrdStream(res, fid, partial, setPrdDocument);
      if (fid && agentContent) {
        await finalizePrdAndPersistAssistant(fid, agentContent);
        await fetch(`/api/features/${fid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        setFeatureStatus("done");
        prdContentDirtyRef.current = false;
        setSavedPrd(true);
        setPrdRecoveryPromptOpen(false);
      }
    } catch (e) {
      console.error(e);
      setStreamError(e instanceof Error ? e.message : "PRD stream failed");
      setPrdRecoveryPromptOpen(true);
    } finally {
      setIsLoading(false);
      streamingRef.current = false;
      prdStreamingBufferRef.current = "";
    }
  };

  const handlePrdRecoveryRegenerate = async () => {
    const fid = featureId;
    if (!fid || !featureData) return;
    setStreamError(null);
    setPrdRecoveryPromptOpen(false);
    setPrdDocument("");
    prdStreamingBufferRef.current = "";
    streamingRef.current = true;
    setIsLoading(true);
    try {
      await fetch(`/api/features/${fid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "generating" }),
      });
      setFeatureStatus("generating");
      await postBeginPrdDraft(fid);

      const res = await fetch("/api/agents/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: fid, ...featureData }),
      });
      if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
      const agentContent = await consumePrdStream(res, fid, "", setPrdDocument);
      if (fid && agentContent) {
        await finalizePrdAndPersistAssistant(fid, agentContent);
        await fetch(`/api/features/${fid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        setFeatureStatus("done");
        prdContentDirtyRef.current = false;
        setSavedPrd(true);
        setPrdRecoveryPromptOpen(false);
      }
    } catch (e) {
      console.error(e);
      setStreamError(e instanceof Error ? e.message : "PRD stream failed");
      setPrdRecoveryPromptOpen(true);
    } finally {
      setIsLoading(false);
      streamingRef.current = false;
      prdStreamingBufferRef.current = "";
    }
  };

  const handlePrdRecoveryEditManually = async () => {
    const fid = featureId;
    if (!fid) return;
    setStreamError(null);
    await fetch(`/api/features/${fid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "review" }),
    });
    setFeatureStatus("review");
    setPrdRecoveryPromptOpen(false);
  };

  const handlePreClarifySkipAll = useCallback(async () => {
    if (!preInferenceClarifyPendingRef.current) return;
    const fid = featureId;
    const fd = featureData;
    if (!fid || !fd) return;

    preInferenceClarifyPendingRef.current = false;
    setClarifyingIsPreInference(false);
    clarifyShownForRef.current.delete(`pre-${fid}`);
    setClarifyingOpen(false);
    setPendingClarifyingQuestions([]);

    try {
      await fetch(`/api/features/${fid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inference_clarifications: { v: 2, questions: [], answers: {} },
        }),
      });
    } catch (e) {
      console.error("Failed to persist skipped clarifications", e);
    }

    await runInitialInference(fid, fd);
  }, [featureId, featureData, runInitialInference]);

  const handleClarifyComplete = async (data: ClarificationAnswers) => {
    setPreInferenceQuestionsError(null);
    setClarifyingOpen(false);
    const questionsSnapshot = pendingClarifyingQuestions;
    setPendingClarifyingQuestions([]);
    const wasPre = preInferenceClarifyPendingRef.current;
    preInferenceClarifyPendingRef.current = false;
    setClarifyingIsPreInference(false);
    if (wasPre && featureId) {
      clarifyShownForRef.current.delete(`pre-${featureId}`);
    }

    const fid = featureId;
    if (fid) {
      try {
        await fetch(`/api/features/${fid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inference_clarifications: {
              v: 2,
              questions: questionsSnapshot,
              answers: data,
            },
          }),
        });
      } catch (e) {
        console.error("Failed to persist clarifications", e);
      }
    }

    const summary = formatClarificationSummary(questionsSnapshot, data);
    const summaryMsgId = Date.now().toString() + "-clarify";
    addMessage({ id: summaryMsgId, role: "user", content: summary });
    if (fid) await persistMessage(fid, "user", summary);

    const fd = featureData;
    if (fid && fd) {
      await runInitialInference(fid, fd, {
        mode: wasPre ? "fresh" : "after_clarify_revise",
      });
    }
  };

  const handleClarifyClose = () => {
    if (preInferenceClarifyPendingRef.current) {
      void handlePreClarifySkipAll();
      return;
    }
    const infMsg = messagesRef.current
      .slice()
      .reverse()
      .find((m) => m.role === "agent" && m.agentType === "inference" && m.status === "needs_review");
    if (infMsg) {
      clarifyShownForRef.current.delete(infMsg.id);
    }
    setClarifyingOpen(false);
    setPendingClarifyingQuestions([]);
  };

  const handleUpdateInferenceInstead = useCallback(() => {
    preInferenceClarifyPendingRef.current = false;
    setClarifyingIsPreInference(false);
    const infMsg = messagesRef.current
      .slice()
      .reverse()
      .find((m) => m.role === "agent" && m.agentType === "inference" && m.status === "needs_review");
    if (infMsg) {
      clarifyShownForRef.current.delete(infMsg.id);
    }
    setClarifyingOpen(false);
    setPendingClarifyingQuestions([]);
    setInferenceReviseHint(true);
    setFocusComposerToken((t) => t + 1);
  }, []);

  const handleViewDocument = () => {
    setDocumentPanelKind("prd");
    clearPanelSearchParams();
    setIsSplitView(true);
  };

  const handleViewAgentDocument = useCallback(
    (kind: "inference" | "competitor") => {
      setDocumentPanelKind(kind);
      clearPanelSearchParams();
      setIsSplitView(true);
    },
    [clearPanelSearchParams],
  );

  const handleSavePrd = async () => {
    if (!featureId || !prdDocument) return;
    setSavingPrd(true);
    try {
      await fetch(`/api/features/${featureId}/prd`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: prdDocument, replaceLatest: true }),
      });
      prdContentDirtyRef.current = false;
      setSavedPrd(true);
      setTimeout(() => setSavedPrd(false), 2000);
    } catch (e) {
      console.error("Failed to save PRD", e);
    } finally {
      setSavingPrd(false);
    }
  };

  const panelMarkdown = useMemo(() => {
    if (documentPanelKind === "prd") return prdDocument;
    if (documentPanelKind === "inference") return inferenceDocument;
    return competitorDocument;
  }, [documentPanelKind, prdDocument, inferenceDocument, competitorDocument]);

  const panelDerivedTitle = useMemo(
    () =>
      deriveDocumentTitle(panelMarkdown, [
        featureData?.name,
        panelKindFallbackLabel(documentPanelKind),
      ]),
    [panelMarkdown, featureData?.name, documentPanelKind],
  );

  const panelExportFilename = useMemo(
    () => buildArtifactFilename(documentPanelKind, panelDerivedTitle, 0),
    [documentPanelKind, panelDerivedTitle],
  );

  // ── Render: Feature List vs Chat Detail ───────────────────────────
  const showList = !featureParam && !chatStarted;

  if (showList) {
    return (
      <div className={styles.listPage}>
        <header className={styles.listHeader}>
          <div className={styles.listHeaderRow}>
            <Link href="/workspaces" className={styles.backLink}>
              ← Workspaces
            </Link>
            <button
              type="button"
              className={styles.listPrimaryBtn}
              onClick={() => {
              setFeatureCreateError(null);
              setIsModalOpen(true);
            }}
            >
              New feature
            </button>
          </div>
          <h1 className={styles.listTitle}>{workspace?.name ?? "Workspace"}</h1>
          {workspace?.description ? (
            <p className={styles.listDescription}>{workspace.description}</p>
          ) : null}
        </header>

        <div className={styles.listTabsRow} role="tablist" aria-label="Workspace sections">
          <Link
            href={`/workspaces/${workspaceId}`}
            className={`${styles.listTab} ${!listViewArtifacts ? styles.listTabActive : ""}`}
            role="tab"
            aria-selected={!listViewArtifacts}
          >
            Features
          </Link>
          <Link
            href={`/workspaces/${workspaceId}?view=artifacts`}
            className={`${styles.listTab} ${listViewArtifacts ? styles.listTabActive : ""}`}
            role="tab"
            aria-selected={listViewArtifacts}
          >
            Artifacts
          </Link>
        </div>

        {!listViewArtifacts ? (
          <>
            <h2 className={styles.listSectionTitle}>Features</h2>
            <div className={styles.listSearchRow}>
              <input
                type="search"
                className={styles.listSearchInput}
                placeholder="Search features…"
                value={featureListSearch}
                onChange={(e) => setFeatureListSearch(e.target.value)}
                aria-label="Search features in this workspace"
              />
            </div>
            {listError && (
              <div className={styles.listError} role="alert">
                {listError}
              </div>
            )}
            {listLoading ? (
              <div className={styles.listEmpty}>Loading features…</div>
            ) : featuresList.length === 0 ? (
              <div className={styles.listEmpty}>
                {debouncedFeatureListSearch.trim()
                  ? "No features match your search."
                  : "No features yet. Create one to start the AI workflow."}
              </div>
            ) : (
              <ul className={styles.featureList}>
                {featuresList.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={`/workspaces/${workspaceId}?feature=${f.id}`}
                      className={styles.featureRow}
                    >
                      <span className={styles.featureRowName}>{f.name}</span>
                      <span className={styles.featureRowMeta}>
                        {statusLabel(f.status)} · {f.priority}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <h2 className={styles.listSectionTitle}>Artifacts</h2>
            <p className={styles.listDescription} style={{ marginBottom: 16 }}>
              Documents across this workspace. Manage issues from a feature (Issues panel) or from{" "}
              <Link href="/issues" className={styles.artifactFeatureLink}>
                Issues
              </Link>{" "}
              in the sidebar.
            </p>
            <div className={styles.listSearchRow}>
              <input
                type="search"
                className={styles.listSearchInput}
                placeholder="Search artifacts…"
                value={artifactListSearch}
                onChange={(e) => setArtifactListSearch(e.target.value)}
                aria-label="Search artifacts in this workspace"
              />
            </div>
            {artifactsError && (
              <div className={styles.listError} role="alert">
                {artifactsError}
              </div>
            )}
            {artifactsLoading ? (
              <div className={styles.listEmpty}>Loading artifacts…</div>
            ) : workspaceArtifacts.length === 0 ? (
              <div className={styles.listEmpty}>
                {debouncedArtifactListSearch.trim()
                  ? "No artifacts match your search."
                  : "No artifacts in this workspace yet. Complete inference, competitor analysis, or PRD generation on a feature."}
              </div>
            ) : (
              <div className={styles.artifactsTableWrap}>
                <table className={styles.artifactsTable}>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Title</th>
                      <th>Feature</th>
                      <th>Updated</th>
                      <th className={styles.artifactsTableActionsCell}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceArtifacts.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className={styles.artifactKindBadge}>
                            {workspaceArtifactKindLabel(r.kind)}
                          </span>
                          {r.version > 1 ? (
                            <span className={styles.artifactVersionMuted}>v{r.version}</span>
                          ) : null}
                        </td>
                        <td>{r.title ?? "—"}</td>
                        <td>
                          <Link
                            href={`/workspaces/${workspaceId}?feature=${r.feature_id}`}
                            className={styles.artifactFeatureLink}
                          >
                            {r.feature_name ?? r.feature_id}
                          </Link>
                        </td>
                        <td className={styles.artifactDate}>{listTimeAgo(r.updated_at)}</td>
                        <td className={styles.artifactsTableActionsCell}>
                          <ArtifactListExportSplitButton
                            featureId={r.feature_id}
                            artifactId={r.id}
                            kind={r.kind}
                            title={r.title}
                            version={r.version}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {isModalOpen && (
          <NewFeatureModal
            onClose={() => {
              setFeatureCreateError(null);
              setIsModalOpen(false);
            }}
            onSubmit={handleStartFeature}
            submitError={featureCreateError}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {isModalOpen && (
        <NewFeatureModal
          onClose={() => {
            setFeatureCreateError(null);
            setIsModalOpen(false);
          }}
          onSubmit={handleStartFeature}
          submitError={featureCreateError}
        />
      )}
      <div className={`${styles.layout} ${isSplitView ? styles.splitActive : ""}`}>
        <div className={styles.chatPane}>
          <header className={styles.paneHeader}>
            <div className={styles.detailHeaderLeft}>
              <Link
                href={`/workspaces/${workspaceId}`}
                className={styles.backLinkInline}
              >
                ← Features
              </Link>
              <h2 className={styles.paneTitle}>
                {featureData?.name || "Feature Conversation"}
              </h2>
            </div>
            <div className={styles.chatPaneHeaderRight}>
              {featureId && featureParam && chatStarted ? (
                <>
                  <button type="button" className={styles.mockBtn} onClick={openArtifactsPanel}>
                    Artifacts
                  </button>
                  <button type="button" className={styles.mockBtn} onClick={openIssuesPanel}>
                    Issues
                  </button>
                </>
              ) : null}
            </div>
          </header>

          <div className={styles.chatWrapperOuter}>
            {preInferenceQuestionsError ? (
              <div className={styles.preInferenceErrorBanner} role="alert">
                <p className={styles.preInferenceErrorText}>{preInferenceQuestionsError}</p>
                <button
                  type="button"
                  className={styles.preInferenceRetryBtn}
                  onClick={() => void retryPreInferenceQuestions()}
                  disabled={isLoading}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {chatStarted ? (
              <ChatInterface
                messages={messages}
                isLoading={isLoading}
                onSend={handleSend}
                onApprove={handleApprove}
                onViewDocument={handleViewDocument}
                onViewAgentDocument={handleViewAgentDocument}
                clarifyingOpen={clarifyingOpen}
                clarifyingQuestions={pendingClarifyingQuestions}
                onClarifyComplete={handleClarifyComplete}
                onClarifyClose={handleClarifyClose}
                clarifyingPreInference={clarifyingIsPreInference}
                onClarifySkipAll={handlePreClarifySkipAll}
                onUpdateInference={handleUpdateInferenceInstead}
                inferenceReviseHint={inferenceReviseHint}
                focusComposerToken={focusComposerToken}
                composerPlaceholder={chatComposerPlaceholder}
              />
            ) : (
              <div className={styles.emptyState}>Loading…</div>
            )}
          </div>
        </div>

        <div className={styles.editorPane}>
          <header className={styles.paneHeader}>
            <div className={styles.editorPaneHeaderInner}>
              {panelIssues ? (
                <h2 className={styles.editorPaneTitleWithFormat}>
                  <span className={styles.docPanelKindBadge}>Issues</span>
                  <span className={styles.docPanelDerivedTitle}>
                    {featureData?.name ?? "Feature"}
                  </span>
                </h2>
              ) : panelArtifacts ? (
                <h2 className={styles.editorPaneTitleWithFormat}>
                  <span className={styles.docPanelKindBadge}>
                    {artifactParam && artifactsHeaderMeta
                      ? workspaceArtifactKindLabel(artifactsHeaderMeta.kind)
                      : "Artifacts"}
                  </span>
                  <span className={styles.docPanelDerivedTitle}>
                    {artifactParam && artifactsHeaderMeta
                      ? artifactsHeaderMeta.title
                      : (featureData?.name ?? "Feature")}
                  </span>
                </h2>
              ) : (
                <h2 className={styles.editorPaneTitleWithFormat}>
                  <span className={styles.docPanelKindBadge}>
                    {workspaceArtifactKindLabel(documentPanelKind)}
                  </span>
                  <span className={styles.docPanelDerivedTitle}>
                    {panelDerivedTitle}
                  </span>
                  <span className={styles.formatDot} aria-hidden>
                    ·
                  </span>
                  <span className={styles.docPanelFormatLabel}>Markdown</span>
                </h2>
              )}
              <div className={styles.editorPaneToolbarRight}>
                {!panelIssues && !panelArtifacts && documentPanelKind === "prd" ? (
                  <button
                    type="button"
                    className={styles.mockBtn}
                    onClick={handleSavePrd}
                    disabled={savingPrd || !featureId}
                  >
                    {savingPrd ? "Saving..." : savedPrd ? "✓ Saved" : "Save Changes"}
                  </button>
                ) : null}
                {!panelIssues && !panelArtifacts ? (
                  <button
                    type="button"
                    className={styles.mockBtn}
                    disabled={!panelMarkdown.trim()}
                    onClick={() => downloadMarkdownFile(panelMarkdown, panelExportFilename)}
                  >
                    Download
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.closeDocBtn}
                  aria-label={
                    panelIssues || panelArtifacts ? "Close side panel" : "Close document"
                  }
                  onClick={() => {
                    if (panelIssues || panelArtifacts) {
                      closeRightPane();
                    } else {
                      setIsSplitView(false);
                    }
                  }}
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </div>
            </div>
          </header>
          {!panelIssues &&
          !panelArtifacts &&
          documentPanelKind === "prd" &&
          streamError ? (
            <div className={styles.streamError} role="alert">
              {streamError}
            </div>
          ) : null}
          {!panelIssues &&
          !panelArtifacts &&
          documentPanelKind === "prd" &&
          prdRecoveryPromptOpen &&
          featureStatus === "generating" ? (
            <PrdRecoveryBanner
              hasDraft={prdDocument.trim().length > 0}
              busy={isLoading}
              onContinue={handlePrdRecoveryContinue}
              onRegenerate={handlePrdRecoveryRegenerate}
              onEditManually={handlePrdRecoveryEditManually}
            />
          ) : null}
          <div
            className={
              (panelIssues || panelArtifacts) && featureId
                ? `${styles.editorContent} ${styles.editorContentIssues}`
                : styles.editorContent
            }
          >
            {panelIssues && featureId ? (
              <FeatureIssuesPanel
                featureId={featureId}
                workspaceId={workspaceId}
                workspaceName={workspace?.name ?? "Workspace"}
                featureName={featureData?.name ?? "Feature"}
                launchGenerateToken={launchIssuesGenerateToken}
                onLaunchGenerateConsumed={handleLaunchGenerateConsumed}
                onIssuesCommitted={handleIssuesCommitted}
              />
            ) : panelArtifacts && featureId ? (
              <FeatureArtifactsPanel
                workspaceId={workspaceId}
                featureId={featureId}
                artifactId={artifactParam}
                kindLabel={workspaceArtifactKindLabel}
                formatTimeAgo={listTimeAgo}
                onHeaderMeta={setArtifactsHeaderMeta}
              />
            ) : (
              <PrdDocumentEditor
                syncKey={featureId ?? "no-feature"}
                readOnly={documentPanelKind !== "prd"}
                streaming={documentPanelKind === "prd" && isLoading}
                ariaBusy={isLoading}
                value={
                  documentPanelKind === "prd"
                    ? prdDocument
                    : documentPanelKind === "inference"
                      ? inferenceDocument
                      : competitorDocument
                }
                onChange={
                  documentPanelKind === "prd"
                    ? (md) => {
                        setPrdDocument(md);
                        prdContentDirtyRef.current = true;
                        setSavedPrd(false);
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
