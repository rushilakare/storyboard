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
import ChatInterface, { Message, type UploadedAttachment } from "@/components/ChatInterface";
import PrdRecoveryBanner from "@/components/PrdRecoveryBanner";
import PrdDocumentEditor from "@/components/PrdDocumentEditor";
import { ArtifactListExportSplitButton } from "@/components/DocumentExportSplitButton";
import FeatureArtifactsPanel from "@/components/artifacts/FeatureArtifactsPanel";
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
  NEW_FEATURE_BOOTSTRAP_KEY,
  type NewFeatureBootstrapPayload,
} from "@/lib/newFeatureBootstrap";

/** Chat shows a stub; full text lives in the document panel and in persisted messages. */
const INFERENCE_CHAT_STUB =
  "Feature inference is ready. Use “View feature inference” to read it in the document panel, then approve to continue.";


type DocumentPanelKind = "inference" | "prd";

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


/** Returns the revision agent type — always inference since competitor step is removed. */
function resolveRevisionAgent(_messages: Message[]): "inference" {
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
  signal?: AbortSignal,
): Promise<{ narrative: string; questions: ClarifyingQuestion[]; interrupted: boolean }> {
  const bufferDocumentUntilDone = options?.bufferDocumentUntilDone ?? false;
  const dropParsedQuestions = options?.dropParsedQuestions ?? false;
  const decoder = new TextDecoder();
  let agentContent = "";
  let interrupted = false;
  while (true) {
    if (signal?.aborted) { interrupted = true; reader.cancel().catch(() => {}); break; }
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) break;
    if (value) agentContent += decoder.decode(value, { stream: true });
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
  const finalContent = interrupted
    ? `${INFERENCE_CHAT_STUB}\n\n_Response interrupted._`
    : INFERENCE_CHAT_STUB;
  setMessages((prev) =>
    prev.map((m) =>
      m.id === agentMsgId
        ? {
            ...m,
            content: finalContent,
            ...(questions.length > 0 ? { clarifyingQuestions: questions } : {}),
            status: "needs_review" as const,
          }
        : m,
    ),
  );
  return { narrative, questions, interrupted };
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
    default:
      return kind;
  }
}

function panelKindFallbackLabel(kind: DocumentPanelKind): string {
  if (kind === "prd") return "PRD";
  return "Feature inference";
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
  const [loadingLabel, setLoadingLabel] = useState<string>("");
  const [featureData, setFeatureData] = useState<{
    name: string;
    purpose: string;
    requirements: string;
  } | null>(null);
  const [prdDocument, setPrdDocument] = useState<string>("");
  const debouncedPrdDocument = useDebouncedValue(prdDocument, 2000);
  const [inferenceDocument, setInferenceDocument] = useState<string>("");
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
  const [artifactsHeaderMeta, setArtifactsHeaderMeta] = useState<{
    kind: string;
    title: string;
  } | null>(null);
  /** Clarifying modal is the pre-inference Q&A step (not post-stream JSON questions). */
  const [clarifyingIsPreInference, setClarifyingIsPreInference] = useState(false);
  const [featureCreateError, setFeatureCreateError] = useState<string | null>(null);
  const [preInferenceQuestionsError, setPreInferenceQuestionsError] = useState<string | null>(null);
  const [modalWorkspaces, setModalWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [modalWorkspacesLoading, setModalWorkspacesLoading] = useState(false);

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const skipNextClassifyRef = useRef(false);

  const [pendingCommand, setPendingCommand] = useState<{
    intent: "regenerate_inference" | "generate_prd" | "regenerate_prd";
    message: string;
  } | null>(null);
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
    if (!isModalOpen) return;
    let cancelled = false;
    setModalWorkspacesLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/workspaces");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setModalWorkspaces([]);
          return;
        }
        const rows = Array.isArray(data)
          ? data.map((w: { id: string; name: string }) => ({ id: w.id, name: w.name }))
          : [];
        setModalWorkspaces(rows);
      } catch {
        if (!cancelled) setModalWorkspaces([]);
      } finally {
        if (!cancelled) setModalWorkspacesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isModalOpen]);

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
    if (featureStatus === "done") {
      return "Describe changes you want in the PRD…";
    }
    return undefined;
  }, [featureStatus]);

  const finalizePrdAndPersistAssistant = useCallback(
    async (fid: string, fullMarkdown: string, artifactTitle?: string | null) => {
      const putRes = await fetch(`/api/features/${fid}/prd`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fullMarkdown, finalize: true, ...(artifactTitle ? { title: artifactTitle } : {}) }),
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
      return line;
    },
    [persistMessage],
  );

  const consumePrdStream = useCallback(
    async (
      res: Response,
      fid: string | null,
      partialPrefix: string,
      setDoc: (s: string) => void,
      signal?: AbortSignal,
    ): Promise<{ content: string; interrupted: boolean }> => {
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
      let interrupted = false;

      while (true) {
        if (signal?.aborted) { interrupted = true; reader.cancel().catch(() => {}); break; }
        const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (done) break;
        if (value) continuation += decoder.decode(value, { stream: true });
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

      return { content: partialPrefix + continuation, interrupted };
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
      setDocumentPanelKind("inference");
      setIsSplitView(true);
      addMessage({
        id: agentMsgId,
        role: "agent",
        agentType: "inference",
        content: "Generating feature inference…",
        status: "pending",
      });

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;
      streamingRef.current = true;
      setLoadingLabel("Analyzing your idea…");
      setIsLoading(true);
      let narrativeForPersistence = "";
      let parsedQuestions: ClarifyingQuestion[] = [];
      let inferenceArtifactTitle: string | undefined;
      try {
        const res = await fetch("/api/agents/infer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featureId: fid, ...form }),
          signal: abortCtrl.signal,
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
          inferenceArtifactTitle = res.headers.get("X-Artifact-Title") ?? undefined;
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
              abortCtrl.signal,
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
        if ((e as Error)?.name !== "AbortError") console.error(e);
      } finally {
        streamingRef.current = false;
        setLoadingLabel("");
        setIsLoading(false);
        abortControllerRef.current = null;
      }

      if (fid && narrativeForPersistence) {
        const meta: Record<string, unknown> = {};
        if (!fid && parsedQuestions.length > 0) meta.clarifying_questions = parsedQuestions;
        if (inferenceArtifactTitle) meta.artifact_title = inferenceArtifactTitle;
        await persistMessage(fid, "assistant", narrativeForPersistence, "inference", Object.keys(meta).length > 0 ? meta : undefined);
      }
    },
    [persistMessage, openClarifyingModal],
  );

  useEffect(() => {
    clarifyShownForRef.current.clear();
  }, [featureParam]);

  useEffect(() => {
    if (featureParam && panelArtifacts) {
      setIsSplitView(true);
    }
  }, [featureParam, panelArtifacts]);

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
            const attachments = Array.isArray(meta?.attachments)
              ? (meta.attachments as { id: string; filename: string; mime_type: string; status?: "ready" | "failed" }[])
              : undefined;
            return {
              id: m.id as string,
              role: (m.role === "user" ? "user" : "agent") as "user" | "agent",
              agentType: (m.agent_type as Message["agentType"]) || undefined,
              content: m.content as string,
              status: "done" as const,
              clarifyingQuestions,
              attachments,
            };
          });

          let extractedInference = "";
          const uiMsgs = rawUiMsgs.map((m) => {
            if (m.role === "agent" && m.agentType === "inference" && isLikelyFullInferenceBody(m.content)) {
              extractedInference = narrativeFromPersistedInference(m.content);
              return { ...m, content: INFERENCE_CHAT_STUB };
            }
            return m;
          });

          setInferenceDocument(extractedInference);

          // Mark last non-system agent message as needs_review when appropriate
          const lastAgentIdx = [...uiMsgs]
            .reverse()
            .findIndex((m) => m.role === "agent" && m.agentType !== "system");
          if (lastAgentIdx >= 0) {
            const realIdx = uiMsgs.length - 1 - lastAgentIdx;
            const lastAgent = uiMsgs[realIdx];
            const needsReview =
              (data.status === "draft" && lastAgent.agentType === "inference") ||
              (data.status === "review" && lastAgent.agentType === "prd");
            if (needsReview) {
              uiMsgs[realIdx] = { ...lastAgent, status: "needs_review" };
            }
          }

          setMessages(uiMsgs);

          if (["review", "done"].includes(data.status) && prdText) {
            setDocumentPanelKind("prd");
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
          }
        } else {
          let ranBootstrap = false;
          if (data.status === "draft" && typeof window !== "undefined") {
            const raw = sessionStorage.getItem(NEW_FEATURE_BOOTSTRAP_KEY);
            if (raw) {
              try {
                const parsed = JSON.parse(raw) as NewFeatureBootstrapPayload;
                if (parsed.featureId === data.id && parsed.workspaceId === workspaceId) {
                  sessionStorage.removeItem(NEW_FEATURE_BOOTSTRAP_KEY);
                  ranBootstrap = true;
                  setPreInferenceQuestionsError(null);
                  setChatStarted(true);
                  setIsModalOpen(false);
                  const summary = `I want a new feature: ${data.name}\n\nPurpose: ${purpose}\nRequirements: ${requirements}`;
                  setMessages([
                    {
                      id: `${Date.now()}-bootstrap-user`,
                      role: "user",
                      content: summary,
                    },
                  ]);
                  await persistMessage(data.id, "user", summary);
                  const qResult = await fetchPreInferenceQuestions(data.id, {
                    name: data.name,
                    purpose,
                    requirements,
                  });
                  if (qResult.ok) {
                    preInferenceClarifyPendingRef.current = true;
                    setClarifyingIsPreInference(true);
                    clarifyShownForRef.current.add(`pre-${data.id}`);
                    setPendingClarifyingQuestions(qResult.questions);
                    setClarifyingOpen(true);
                  } else {
                    setPreInferenceQuestionsError(qResult.error);
                  }
                }
              } catch {
                sessionStorage.removeItem(NEW_FEATURE_BOOTSTRAP_KEY);
              }
            }
          }

          if (!ranBootstrap) {
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
  }, [featureParam, workspaceId, router, persistMessage, fetchPreInferenceQuestions]);

  const retryPreInferenceQuestions = useCallback(async () => {
    const fid = featureId;
    const fd = featureData;
    if (!fid || !fd) return;
    setPreInferenceQuestionsError(null);
    setLoadingLabel("Fetching questions…");
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
      setLoadingLabel("");
      setIsLoading(false);
      streamingRef.current = false;
    }
  }, [featureId, featureData, fetchPreInferenceQuestions]);

  // ── New Feature Flow ──────────────────────────────────────────────
  const handleStartFeature = async (data: {
    name: string;
    purpose: string;
    requirements: string;
    workspace_id: string;
    files?: File[];
  }) => {
    const targetWorkspaceId = data.workspace_id || workspaceId;
    setFeatureCreateError(null);
    setPreInferenceQuestionsError(null);
    setFeatureData({
      name: data.name,
      purpose: data.purpose,
      requirements: data.requirements,
    });
    setLoadingLabel("Saving your feature…");
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
          workspace_id: targetWorkspaceId,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        setFeatureCreateError(errText || res.statusText || "Could not create feature.");
        setLoadingLabel("");
        setIsLoading(false);
        return;
      }
      const saved = await res.json();
      newId = saved.id;
      setFeatureId(saved.id);
    } catch (e) {
      console.error("Failed to persist feature", e);
      setFeatureCreateError(e instanceof Error ? e.message : "Could not create feature.");
      setLoadingLabel("");
      setIsLoading(false);
      return;
    }

    if (!newId) {
      setLoadingLabel("");
      setIsLoading(false);
      return;
    }

    const createdFeatureId = newId;

    // Upload attachments before navigating (so they're ready for the first agent call)
    if (data.files && data.files.length > 0) {
      setLoadingLabel("Uploading files…");
      for (let i = 0; i < data.files.length; i++) {
        const f = data.files[i];
        setFeatureCreateError(`Uploading ${f.name} (${i + 1} of ${data.files.length})…`);
        try {
          const form = new FormData();
          form.append("file", f);
          const attRes = await fetch(`/api/features/${createdFeatureId}/attachments`, {
            method: "POST",
            body: form,
          });
          if (!attRes.ok) {
            const errText = await attRes.text().catch(() => "");
            setFeatureCreateError(errText || `Failed to upload ${f.name}`);
            setLoadingLabel("");
            setIsLoading(false);
            return;
          }
          // status:'failed' is non-blocking — extraction error on the server side
        } catch (e) {
          setFeatureCreateError(e instanceof Error ? e.message : `Failed to upload ${f.name}`);
          setLoadingLabel("");
          setIsLoading(false);
          return;
        }
      }
      setFeatureCreateError(null);
    }

    setIsModalOpen(false);
    setChatStarted(true);
    streamingRef.current = true;
    router.replace(`/workspaces/${targetWorkspaceId}?feature=${createdFeatureId}`);

    const userContent = `I want a new feature: ${data.name}\n\nPurpose: ${data.purpose}\nRequirements: ${data.requirements}`;
    addMessage({ id: Date.now().toString(), role: "user", content: userContent });
    await persistMessage(createdFeatureId, "user", userContent);

    setLoadingLabel("Checking for questions…");
    const qResult = await fetchPreInferenceQuestions(createdFeatureId, data);
    setLoadingLabel("");
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
  const handleSend = async (text: string, attachments?: UploadedAttachment[]) => {
    const lastAgentMsg = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === "agent" && m.agentType !== "system");

    if (lastAgentMsg?.agentType === "prd" && lastAgentMsg.status === "pending") {
      return;
    }

    const doClassify = !skipNextClassifyRef.current;
    skipNextClassifyRef.current = false;

    // Files are uploaded before send (in ChatInterface); available as metadata here
    const uploadedAttachments = attachments ?? [];

    // Show user message immediately before any async work — include attachments so chips appear instantly
    addMessage({
      id: Date.now().toString(),
      role: "user",
      content: text,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
    });
    setLoadingLabel("Thinking…");
    setIsLoading(true);

    // LLM intent classification (only when we have a feature context, skip when explicitly bypassed)
    let routeToDiscussion = false;
    let hasInference = false;
    let hasPrd = false;

    if (featureId && doClassify) {
      hasInference = messagesRef.current.some((m) => m.role === "agent" && m.agentType === "inference");
      hasPrd = messagesRef.current.some((m) => m.role === "agent" && m.agentType === "prd");
      try {
        const classifyRes = await fetch(`/api/features/${featureId}/classify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, featureState: { hasInference, hasPrd } }),
        });
        if (classifyRes.ok) {
          const { intent } = await classifyRes.json() as { intent: string };
          if (intent === "regenerate_inference" || intent === "generate_prd" || intent === "regenerate_prd") {
            setLoadingLabel("");
            setIsLoading(false);
            setPendingCommand({ intent: intent as "regenerate_inference" | "generate_prd" | "regenerate_prd", message: text });
            return;
          }
          // Classifier returned "discussion" and there's context to discuss
          if (intent === "discussion" && hasInference) {
            routeToDiscussion = true;
          }
        } else if (hasInference && hasPrd) {
          routeToDiscussion = true;
        }
      } catch {
        if (hasInference && hasPrd) routeToDiscussion = true;
      }
    }

    // ── Discussion branch — inline streaming reply, no document agent, no artifact ──
    if (routeToDiscussion && featureId) {
      const fid = featureId;

      // Persist user message in background (include attachment metadata if any)
      const discussMeta = uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : null;
      persistMessage(fid, "user", text, null, discussMeta).catch(console.error);

      const discussMsgId = Date.now().toString() + "-discuss";
      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;
      streamingRef.current = true;

      // isLoading + loadingLabel already set above — dots show while classify ran and while stream starts
      let discussContent = "";
      try {
        const readyAttachmentIds = uploadedAttachments
          .filter((a) => a.status === "ready")
          .map((a) => a.id);
        const res = await fetch(`/api/features/${fid}/discuss`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            ...(readyAttachmentIds.length > 0 && { attachmentIds: readyAttachmentIds }),
          }),
          signal: abortCtrl.signal,
        });
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            discussContent += chunk;
            // Add bubble on first chunk so dots → content transition is seamless
            if (discussContent.length === chunk.length) {
              addMessage({ id: discussMsgId, role: "agent", agentType: "discussion", content: discussContent, status: "pending" });
              setIsLoading(false);
              setLoadingLabel("");
            } else {
              setMessages((prev) => prev.map((m) => m.id === discussMsgId ? { ...m, content: discussContent } : m));
            }
          }
          setMessages((prev) => prev.map((m) => m.id === discussMsgId ? { ...m, status: "done" as const } : m));
          if (discussContent) await persistMessage(fid, "assistant", discussContent, "discussion", null);
        } else {
          console.error("discuss failed", res.statusText);
          addMessage({ id: discussMsgId, role: "agent", agentType: "discussion", content: "Discussion request failed. Please try again.", status: "needs_review" });
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          if (discussContent) {
            setMessages((prev) => prev.map((m) => m.id === discussMsgId ? { ...m, status: "done" as const } : m));
          }
        } else {
          addMessage({ id: discussMsgId, role: "agent", agentType: "discussion", content: "Discussion request failed. Please try again.", status: "needs_review" });
        }
      }

      setLoadingLabel("");
      setIsLoading(false);
      streamingRef.current = false;
      abortControllerRef.current = null;
      return;
    }

    const isPrdRevision =
      featureStatus === "done" ||
      (lastAgentMsg?.agentType === "prd" &&
        lastAgentMsg.status !== "pending" &&
        lastAgentMsg.status !== undefined);

    const agentType = resolveRevisionAgent(messagesRef.current);
    const endpoint = isPrdRevision ? "/api/agents/prd" : "/api/agents/infer";

    const agentMsgId = Date.now().toString() + "-agent";

    setInferenceReviseHint(false);

    if (!isPrdRevision && agentType === "inference") {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "agent" && m.agentType === "inference" && m.status === "needs_review"
            ? { ...m, status: "done" as const }
            : m,
        ),
      );
    }

    const fid = featureId;

    if (fid) {
      const meta = uploadedAttachments.length > 0
        ? { attachments: uploadedAttachments }
        : undefined;
      await persistMessage(fid, "user", text, null, meta ?? null);
    }

    if (isPrdRevision) {
      setDocumentPanelKind("prd");
      setIsSplitView(true);
      prdStreamingBufferRef.current = "";
      if (fid) await postBeginPrdDraft(fid);
      addMessage({
        id: agentMsgId,
        role: "agent",
        agentType: "prd",
        content: "Generating PRD…",
        status: "pending",
      });
    } else {
      if (agentType === "inference") {
        setDocumentPanelKind("inference");
        setIsSplitView(true);
        setInferenceDocument("");
      }
      addMessage({
        id: agentMsgId,
        role: "agent",
        agentType: "inference",
        content: "Generating feature inference…",
        status: "pending",
      });
    }

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;
    streamingRef.current = true;
    setLoadingLabel(isPrdRevision ? "Writing your PRD…" : "Analyzing your feature…");
    let agentContent = "";
    let prdFetchSucceeded = false;
    let prdStreamError = false;
    let prdInterrupted = false;
    let sendArtifactTitle: string | undefined;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: fid, ...featureData, revision: text }),
        signal: abortCtrl.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Agent request failed", err);
        if (isPrdRevision) {
          setStreamError(err || res.statusText);
          setPrdRecoveryPromptOpen(true);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId
                ? { ...m, content: `Error: ${err || res.statusText}`, status: "needs_review" as const }
                : m,
            ),
          );
          if (fid) {
            await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "review" }) });
            setFeatureStatus("review");
          }
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId
                ? { ...m, content: `Error: ${err || res.statusText}`, status: "needs_review" }
                : m,
            ),
          );
        }
      } else if (isPrdRevision) {
        prdFetchSucceeded = true;
        sendArtifactTitle = res.headers.get("X-Artifact-Title") ?? undefined;
        const { content, interrupted } = await consumePrdStream(res, fid, "", setPrdDocument, abortCtrl.signal);
        agentContent = content;
        prdInterrupted = interrupted;
      } else {
        sendArtifactTitle = res.headers.get("X-Artifact-Title") ?? undefined;
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
              abortCtrl.signal,
            );
            agentContent = narrative;
            if (!fid && questions.length > 0) {
              setPendingClarifyingQuestions(questions);
              openClarifyingModal(agentMsgId);
            } else {
              setPendingClarifyingQuestions([]);
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        console.error(e);
        if (isPrdRevision) {
          prdStreamError = true;
          const msg = e instanceof Error ? e.message : "Stream failed";
          setStreamError(msg);
          setPrdRecoveryPromptOpen(true);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId
                ? { ...m, content: `Error: ${msg}`, status: "needs_review" as const }
                : m,
            ),
          );
          if (fid) {
            await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "review" }) });
            setFeatureStatus("review");
          }
        }
      }
    }

    if (isPrdRevision && prdInterrupted) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, content: "PRD generation was interrupted. Your partial draft has been saved.", status: "needs_review" as const }
            : m,
        ),
      );
      setPrdRecoveryPromptOpen(true);
      if (fid) {
        await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "review" }) });
        setFeatureStatus("review");
      }
    } else if (isPrdRevision && fid && agentContent) {
      try {
        const line = await finalizePrdAndPersistAssistant(fid, agentContent, sendArtifactTitle);
        prdContentDirtyRef.current = false;
        setSavedPrd(true);
        await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
        setFeatureStatus("done");
        setPrdRecoveryPromptOpen(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: line, status: "done" as const } : m,
          ),
        );
      } catch (pe) {
        console.error("Failed to save PRD after revision", pe);
      }
    } else if (isPrdRevision && fid && prdFetchSucceeded && !agentContent && !prdStreamError) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, content: "PRD revision produced no content.", status: "needs_review" as const }
            : m,
        ),
      );
    } else if (fid && agentContent && !isPrdRevision) {
      const meta: Record<string, unknown> = {};
      if (sendArtifactTitle) meta.artifact_title = sendArtifactTitle;
      await persistMessage(fid, "assistant", agentContent, agentType, Object.keys(meta).length > 0 ? meta : undefined);
    }

    if (isPrdRevision) {
      prdStreamingBufferRef.current = "";
    }
    setLoadingLabel("");
    setIsLoading(false);
    streamingRef.current = false;
    abortControllerRef.current = null;
  };

  // ── Approve + Next Stage ──────────────────────────────────────────
  const handleApprove = async (msgId: string, agentType: string) => {
    setLoadingLabel("Preparing your PRD…");
    setIsLoading(true);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: "done" } : m)),
    );

    const fid = featureId;

    try {
      if (agentType === "inference") {
        setDocumentPanelKind("prd");
        setIsSplitView(true);

        const sysContent = "Great! Generating the PRD document…";
        addMessage({
          id: Date.now().toString() + "sys",
          role: "agent",
          agentType: "system",
          content: sysContent,
        });
        if (fid) void persistMessage(fid, "system", sysContent, "system");

        if (fid) {
          await fetch(`/api/features/${fid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "generating" }),
          });
          setFeatureStatus("generating");
          setPrdRecoveryPromptOpen(false);
          await postBeginPrdDraft(fid);
        }

        const prdMsgId = `${Date.now()}-prd-start`;
        addMessage({
          id: prdMsgId,
          role: "agent",
          agentType: "prd",
          content: "Generating PRD…",
          status: "pending",
        });

        const abortCtrl = new AbortController();
        abortControllerRef.current = abortCtrl;
        streamingRef.current = true;
        prdStreamingBufferRef.current = "";
        setStreamError(null);

        try {
          const res = await fetch("/api/agents/prd", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ featureId: fid, ...featureData }),
            signal: abortCtrl.signal,
          });

          if (!res.ok) {
            const err = await res.text();
            setStreamError(err || res.statusText);
            setPrdRecoveryPromptOpen(true);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === prdMsgId
                  ? { ...m, content: `Error: ${err || res.statusText}`, status: "needs_review" as const }
                  : m,
              ),
            );
            if (fid) {
              await fetch(`/api/features/${fid}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "review" }),
              });
              setFeatureStatus("review");
            }
          } else {
            const prdArtifactTitle = res.headers.get("X-Artifact-Title") ?? undefined;
              const { content: agentContent, interrupted } = await consumePrdStream(res, fid, "", setPrdDocument, abortCtrl.signal);
            if (interrupted) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === prdMsgId
                    ? { ...m, content: "PRD generation was interrupted. Your partial draft has been saved.", status: "needs_review" as const }
                    : m,
                ),
              );
              setPrdRecoveryPromptOpen(true);
              if (fid) {
                await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "review" }) });
                setFeatureStatus("review");
              }
            } else if (fid && agentContent) {
              const line = await finalizePrdAndPersistAssistant(fid, agentContent, prdArtifactTitle);
              await fetch(`/api/features/${fid}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "done" }),
              });
              setFeatureStatus("done");
              prdContentDirtyRef.current = false;
              setSavedPrd(true);
              setPrdRecoveryPromptOpen(false);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === prdMsgId ? { ...m, content: line, status: "done" as const } : m,
                ),
              );
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === prdMsgId
                    ? {
                        ...m,
                        content: "PRD generation produced no content.",
                        status: "needs_review" as const,
                      }
                    : m,
                ),
              );
            }
          }
        } catch (e) {
          if ((e as Error)?.name !== "AbortError") {
            console.error("PRD stream error", e);
            const msg = e instanceof Error ? e.message : "Stream failed";
            setStreamError(msg);
            setPrdRecoveryPromptOpen(true);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === prdMsgId
                  ? { ...m, content: `Error: ${msg}`, status: "needs_review" as const }
                  : m,
              ),
            );
            if (fid) {
              await fetch(`/api/features/${fid}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "review" }),
              });
              setFeatureStatus("review");
            }
          }
        } finally {
          streamingRef.current = false;
          prdStreamingBufferRef.current = "";
          abortControllerRef.current = null;
        }
      }
    } catch (e) {
      console.error(e);
    }
    setLoadingLabel("");
    setIsLoading(false);
  };

  const handlePrdRecoveryContinue = async () => {
    const fid = featureId;
    if (!fid || !featureData) return;
    setStreamError(null);
    setPrdRecoveryPromptOpen(false);
    const partial = prdDocument;
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;
    streamingRef.current = true;
    setLoadingLabel("Resuming PRD draft…");
    setIsLoading(true);
    prdStreamingBufferRef.current = partial;
    try {
      await postBeginPrdDraft(fid);
      const res = await fetch("/api/agents/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: fid, ...featureData, continue: partial }),
        signal: abortCtrl.signal,
      });
      const prdArtifactTitle = res.ok ? (res.headers.get("X-Artifact-Title") ?? undefined) : undefined;
      const { content: agentContent } = await consumePrdStream(res, fid, partial, setPrdDocument, abortCtrl.signal);
      if (fid && agentContent) {
        await finalizePrdAndPersistAssistant(fid, agentContent, prdArtifactTitle);
        await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
        setFeatureStatus("done");
        prdContentDirtyRef.current = false;
        setSavedPrd(true);
        setPrdRecoveryPromptOpen(false);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        console.error(e);
        setStreamError(e instanceof Error ? e.message : "PRD stream failed");
        setPrdRecoveryPromptOpen(true);
      }
    } finally {
      setLoadingLabel("");
      setIsLoading(false);
      streamingRef.current = false;
      prdStreamingBufferRef.current = "";
      abortControllerRef.current = null;
    }
  };

  const handlePrdRecoveryRegenerate = async () => {
    const fid = featureId;
    if (!fid || !featureData) return;
    setStreamError(null);
    setPrdRecoveryPromptOpen(false);
    setPrdDocument("");
    prdStreamingBufferRef.current = "";
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;
    streamingRef.current = true;
    setLoadingLabel("Writing your PRD…");
    setIsLoading(true);
    try {
      await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "generating" }) });
      setFeatureStatus("generating");
      await postBeginPrdDraft(fid);

      const res = await fetch("/api/agents/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: fid, ...featureData }),
        signal: abortCtrl.signal,
      });
      const prdArtifactTitle = res.ok ? (res.headers.get("X-Artifact-Title") ?? undefined) : undefined;
      const { content: agentContent } = await consumePrdStream(res, fid, "", setPrdDocument, abortCtrl.signal);
      if (fid && agentContent) {
        await finalizePrdAndPersistAssistant(fid, agentContent, prdArtifactTitle);
        await fetch(`/api/features/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
        setFeatureStatus("done");
        prdContentDirtyRef.current = false;
        setSavedPrd(true);
        setPrdRecoveryPromptOpen(false);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        console.error(e);
        setStreamError(e instanceof Error ? e.message : "PRD stream failed");
        setPrdRecoveryPromptOpen(true);
      }
    } finally {
      setLoadingLabel("");
      setIsLoading(false);
      streamingRef.current = false;
      prdStreamingBufferRef.current = "";
      abortControllerRef.current = null;
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

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<UploadedAttachment> => {
    const fid = featureIdRef.current;
    if (!fid) return { id: "", filename: file.name, mime_type: file.type, status: "failed" };
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/features/${fid}/attachments`, { method: "POST", body: form });
      if (!res.ok) return { id: "", filename: file.name, mime_type: file.type, status: "failed" };
      const att = await res.json() as { id: string; filename: string; mime_type: string; status: string };
      return { id: att.id, filename: att.filename, mime_type: att.mime_type, status: att.status === "failed" ? "failed" : "ready" };
    } catch {
      return { id: "", filename: file.name, mime_type: file.type, status: "failed" };
    }
  }, []);

  const handleCommandConfirm = useCallback(async () => {
    if (!pendingCommand) return;
    const { intent, message } = pendingCommand;
    setPendingCommand(null);

    // Show acknowledgment bubble
    addMessage({
      id: `${Date.now()}-cmd-ack`,
      role: "agent",
      agentType: "system",
      content: intent === "regenerate_inference"
        ? "Re-running feature inference…"
        : intent === "generate_prd"
          ? "Generating PRD…"
          : "Regenerating PRD…",
      status: "done",
    });
    addMessage({ id: `${Date.now()}-cmd-user`, role: "user", content: message });
    if (featureId) await persistMessage(featureId, "user", message);

    if (intent === "regenerate_inference" && featureId && featureData) {
      await runInitialInference(featureId, featureData, { mode: "after_clarify_revise" });
    } else if (intent === "generate_prd") {
      // Find the latest inference message to approve
      const infMsg = [...messagesRef.current].reverse().find(
        (m) => m.role === "agent" && m.agentType === "inference",
      );
      if (infMsg) await handleApprove(infMsg.id, "inference");
    } else if (intent === "regenerate_prd") {
      await handlePrdRecoveryRegenerate();
    }
  }, [pendingCommand, featureId, featureData, runInitialInference, persistMessage]);

  const handleCommandDecline = useCallback(async () => {
    if (!pendingCommand) return;
    const { message } = pendingCommand;
    setPendingCommand(null);
    // Send as a regular discussion message, bypassing classification
    skipNextClassifyRef.current = true;
    await handleSend(message);
  }, [pendingCommand]);

  const handleViewDocument = () => {
    setDocumentPanelKind("prd");
    clearPanelSearchParams();
    setIsSplitView(true);
  };

  const handleViewAgentDocument = useCallback(
    (kind: "inference") => {
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

  // Auto-save PRD edits after 2 s of inactivity
  useEffect(() => {
    if (!prdContentDirtyRef.current || !featureId || !debouncedPrdDocument || streamingRef.current) return;
    void handleSavePrd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPrdDocument, featureId]);

  const panelMarkdown = useMemo(() => {
    if (documentPanelKind === "prd") return prdDocument;
    return inferenceDocument;
  }, [documentPanelKind, prdDocument, inferenceDocument]);

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
              Documents across this workspace. Open a feature to view or export artifacts from the Artifacts
              panel.
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
                  : "No artifacts in this workspace yet. Complete inference or PRD generation on a feature."}
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
            workspaces={modalWorkspaces}
            workspacesLoading={modalWorkspacesLoading}
            defaultWorkspaceId={workspaceId}
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
          workspaces={modalWorkspaces}
          workspacesLoading={modalWorkspacesLoading}
          defaultWorkspaceId={workspaceId}
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
                <button type="button" className={styles.mockBtn} onClick={openArtifactsPanel}>
                  Artifacts
                </button>
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
                loadingLabel={loadingLabel}
                onSend={handleSend}
                onStop={handleStop}
                onApprove={handleApprove}
                uploadFile={uploadFile}
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
                pendingCommand={pendingCommand}
                onCommandConfirm={handleCommandConfirm}
                onCommandDecline={handleCommandDecline}
              />
            ) : (
              <div className={styles.emptyState}>Loading…</div>
            )}
          </div>
        </div>

        <div className={styles.editorPane}>
          <header className={styles.paneHeader}>
            <div className={styles.editorPaneHeaderInner}>
              {panelArtifacts ? (
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
                {!panelArtifacts && documentPanelKind === "prd" ? (
                  <button
                    type="button"
                    className={styles.mockBtn}
                    onClick={handleSavePrd}
                    disabled={savingPrd || !featureId}
                  >
                    {savingPrd ? "Saving..." : savedPrd ? "✓ Saved" : "Save Changes"}
                  </button>
                ) : null}
                {!panelArtifacts ? (
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
                  aria-label={panelArtifacts ? "Close side panel" : "Close document"}
                  onClick={() => {
                    if (panelArtifacts) {
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
          {!panelArtifacts &&
          documentPanelKind === "prd" &&
          streamError ? (
            <div className={styles.streamError} role="alert">
              {streamError}
            </div>
          ) : null}
          {!panelArtifacts &&
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
              panelArtifacts && featureId
                ? `${styles.editorContent} ${styles.editorContentIssues}`
                : styles.editorContent
            }
          >
            {panelArtifacts && featureId ? (
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
                    : inferenceDocument
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
