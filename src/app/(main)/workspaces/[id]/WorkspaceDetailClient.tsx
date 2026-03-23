"use client";

import { useState, useEffect, use, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import styles from "./page.module.css";
import NewFeatureModal from "@/components/NewFeatureModal";
import ChatInterface, { Message } from "@/components/ChatInterface";
import PrdRecoveryBanner from "@/components/PrdRecoveryBanner";
import PrdDocumentEditor from "@/components/PrdDocumentEditor";
import type { ClarificationAnswers, ClarifyingQuestion } from "@/lib/postInferenceQuestions";
import {
  formatClarificationSummary,
  isInferenceClarificationsV2,
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
  "Competitor analysis is ready. Use “View competitor analysis” in the document panel, then approve to generate the PRD.";

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

async function consumeInferenceStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  agentMsgId: string,
  setMessages: Dispatch<SetStateAction<Message[]>>,
  setInferenceDoc: Dispatch<SetStateAction<string>>,
): Promise<{ narrative: string; questions: ClarifyingQuestion[] }> {
  const decoder = new TextDecoder();
  let agentContent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    agentContent += decoder.decode(value, { stream: true });
    const { display } = splitInferenceDisplayBuffer(agentContent);
    setInferenceDoc(display);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId ? { ...m, content: "Generating feature inference…" } : m,
      ),
    );
  }
  const { narrative, questions } = parseInferenceStreamComplete(agentContent);
  setInferenceDoc(narrative);
  setMessages((prev) =>
    prev.map((m) =>
      m.id === agentMsgId
        ? {
            ...m,
            content: INFERENCE_CHAT_STUB,
            clarifyingQuestions: questions,
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
  const [featureStatus, setFeatureStatus] = useState<string | null>(null);
  const [prdRecoveryPromptOpen, setPrdRecoveryPromptOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const streamingRef = useRef(false);
  const featureIdRef = useRef<string | null>(null);
  const prdStreamingBufferRef = useRef<string>("");
  // Tracks which inference message IDs already triggered the clarifying modal
  const clarifyShownForRef = useRef<Set<string>>(new Set());
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
    setIsModalOpen(false);
    setClarifyingOpen(false);
    setPendingClarifyingQuestions([]);
  }, [featureParam]);

  const openClarifyingModal = useCallback((inferMsgId: string) => {
    if (clarifyShownForRef.current.has(inferMsgId)) return;
    clarifyShownForRef.current.add(inferMsgId);
    setClarifyingOpen(true);
  }, []);

  useEffect(() => {
    clarifyShownForRef.current.clear();
  }, [featureParam]);

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
              (data.status === "in_progress" && lastAgent.agentType === "competitor");
            if (needsReview) {
              uiMsgs[realIdx] = { ...lastAgent, status: "needs_review" };
            }
          }

          setMessages(uiMsgs);

          const lastInf = [...uiMsgs].reverse().find(
            (m) => m.role === "agent" && m.agentType === "inference" && m.status === "needs_review",
          );
          const hasV2Saved = isInferenceClarificationsV2(data.inference_clarifications);
          if (
            data.status === "draft" &&
            lastInf &&
            !hasV2Saved &&
            lastInf.clarifyingQuestions &&
            lastInf.clarifyingQuestions.length > 0
          ) {
            setPendingClarifyingQuestions(lastInf.clarifyingQuestions);
            openClarifyingModal(lastInf.id);
          }
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
                content: "Loaded from workspace. Approve to generate the PRD, or revise.",
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

        setChatStarted(true);
        setIsModalOpen(false);
      } catch {
        if (!cancelled) router.replace(`/workspaces/${workspaceId}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [featureParam, workspaceId, router, openClarifyingModal]);

  // ── New Feature Flow ──────────────────────────────────────────────
  const handleStartFeature = async (data: {
    name: string;
    purpose: string;
    requirements: string;
  }) => {
    setIsModalOpen(false);
    setChatStarted(true);
    setFeatureData(data);

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
      if (res.ok) {
        const saved = await res.json();
        newId = saved.id;
        setFeatureId(saved.id);
        // Block hydration from overwriting local chat while URL updates (race before infer finishes).
        streamingRef.current = true;
        router.replace(`/workspaces/${workspaceId}?feature=${saved.id}`);
      }
    } catch (e) {
      console.error("Failed to persist feature", e);
    }

    const userContent = `I want a new feature: ${data.name}\n\nPurpose: ${data.purpose}\nRequirements: ${data.requirements}`;
    addMessage({ id: Date.now().toString(), role: "user", content: userContent });

    if (newId) {
      await persistMessage(newId, "user", userContent);
    }

    const agentMsgId = Date.now().toString() + "-agent";
    setInferenceDocument("");
    setCompetitorDocument("");
    setDocumentPanelKind("inference");
    setIsSplitView(true);
    addMessage({
      id: agentMsgId,
      role: "agent",
      agentType: "inference",
      content: "Generating feature inference…",
      status: "pending",
    });

    if (!newId) {
      streamingRef.current = true;
    }
    setIsLoading(true);
    let narrativeForPersistence = "";
    let parsedQuestions: ClarifyingQuestion[] = [];
    try {
      const res = await fetch("/api/agents/infer", {
        method: "POST",
        body: JSON.stringify({ featureId: newId, ...data }),
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
          const { narrative, questions } = await consumeInferenceStream(
            reader,
            agentMsgId,
            setMessages,
            setInferenceDocument,
          );
          narrativeForPersistence = narrative;
          parsedQuestions = questions;
          if (questions.length > 0) {
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

    if (newId && narrativeForPersistence) {
      await persistMessage(newId, "assistant", narrativeForPersistence, "inference", {
        clarifying_questions: parsedQuestions,
      });
    }
  };

  // ── User Revision ─────────────────────────────────────────────────
  const handleSend = async (text: string) => {
    const lastAgentMsg = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === "agent" && m.agentType !== "system");

    addMessage({ id: Date.now().toString(), role: "user", content: text });

    const fid = featureId;
    if (fid) {
      await persistMessage(fid, "user", text);
    }

    const endpoint =
      lastAgentMsg?.agentType === "competitor"
        ? "/api/agents/competitor"
        : lastAgentMsg?.agentType === "prd"
          ? "/api/agents/prd"
          : "/api/agents/infer";

    const isPrd = endpoint === "/api/agents/prd";
    const agentMsgId = Date.now().toString() + "-agent";
    const agentType = lastAgentMsg?.agentType || "inference";

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
    let inferenceQuestionsForMeta: ClarifyingQuestion[] = [];
    if (isPrd) {
      setDocumentPanelKind("prd");
      setIsSplitView(true);
      /* Revision returns a full replacement PRD, not an append — stream from empty prefix. */
      prdStreamingBufferRef.current = "";
      if (fid) await postBeginPrdDraft(fid);
    }
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
        if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
        agentContent = await consumePrdStream(res, fid, "", setPrdDocument);
      } else {
        if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
        if (res.body) {
          const reader = res.body.getReader();
          if (agentType === "inference") {
            const { narrative, questions } = await consumeInferenceStream(
              reader,
              agentMsgId,
              setMessages,
              setInferenceDocument,
            );
            agentContent = narrative;
            inferenceQuestionsForMeta = questions;
            if (questions.length > 0) {
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
        try {
          await finalizePrdAndPersistAssistant(fid, agentContent);
          setSavedPrd(true);
        } catch (pe) {
          console.error("Failed to save PRD after revision", pe);
        }
      } else if (agentType === "inference") {
        await persistMessage(fid, "assistant", agentContent, agentType, {
          clarifying_questions: inferenceQuestionsForMeta,
        });
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
        }

        setDocumentPanelKind("prd");

        const sysContent = "Great! Generating the PRD Document...";
        addMessage({
          id: Date.now().toString() + "sys",
          role: "agent",
          agentType: "system",
          content: sysContent,
        });
        if (fid) void persistMessage(fid, "system", sysContent, "system");
        setIsSplitView(true);

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

        const prdMsgId = Date.now().toString() + "-prd";
        addMessage({
          id: prdMsgId,
          role: "agent",
          agentType: "prd",
          content: "Drafting the Product Requirements Document. Please watch the editor panel...",
          status: "pending",
        });

        streamingRef.current = true;
        prdStreamingBufferRef.current = "";
        setStreamError(null);
        let agentContent = "";
        try {
          const res = await fetch("/api/agents/prd", {
            method: "POST",
            body: JSON.stringify({ featureId: fid, ...featureData }),
          });

          if (res.ok) appendKnowledgeBaseChatLine(addMessage, res);
          agentContent = await consumePrdStream(res, fid, "", setPrdDocument);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === prdMsgId
                ? {
                    ...m,
                    status: "done",
                    content: "The PRD is ready for review. Click below to view the document.",
                  }
                : m,
            ),
          );

          if (fid && agentContent) {
            try {
              await finalizePrdAndPersistAssistant(fid, agentContent);
              await fetch(`/api/features/${fid}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "done" }),
              });
              setFeatureStatus("done");
              setSavedPrd(true);
            } catch (e) {
              console.error("Failed to auto-save PRD", e);
            }
          }
        } catch (e) {
          console.error(e);
          setStreamError(e instanceof Error ? e.message : "PRD generation failed");
          setPrdRecoveryPromptOpen(true);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === prdMsgId
                ? {
                    ...m,
                    status: "done",
                    content:
                      "PRD generation hit an error or was interrupted. Use the recovery panel to continue.",
                  }
                : m,
            ),
          );
        } finally {
          streamingRef.current = false;
          prdStreamingBufferRef.current = "";
        }
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

  const handleClarifyComplete = async (data: ClarificationAnswers) => {
    setClarifyingOpen(false);
    const questionsSnapshot = pendingClarifyingQuestions;
    setPendingClarifyingQuestions([]);

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

    // Show the user's answers as a chat message
    const summary = formatClarificationSummary(questionsSnapshot, data);
    const summaryMsgId = Date.now().toString() + "-clarify";
    addMessage({ id: summaryMsgId, role: "user", content: summary });
    if (fid) persistMessage(fid, "user", summary);

    // Auto-proceed: find the inference needs_review message and approve it
    const infMsg = messagesRef.current
      .slice()
      .reverse()
      .find((m) => m.role === "agent" && m.agentType === "inference" && m.status === "needs_review");
    if (infMsg) {
      await handleApprove(infMsg.id, "inference");
    }
  };

  const handleClarifyClose = () => {
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

  const handleViewDocument = () => {
    setDocumentPanelKind("prd");
    setIsSplitView(true);
  };

  const handleViewAgentDocument = useCallback((kind: "inference" | "competitor") => {
    setDocumentPanelKind(kind);
    setIsSplitView(true);
  }, []);

  const handleSavePrd = async () => {
    if (!featureId || !prdDocument) return;
    setSavingPrd(true);
    try {
      await fetch(`/api/features/${featureId}/prd`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: prdDocument, replaceLatest: true }),
      });
      setSavedPrd(true);
      setTimeout(() => setSavedPrd(false), 2000);
    } catch (e) {
      console.error("Failed to save PRD", e);
    } finally {
      setSavingPrd(false);
    }
  };

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
              onClick={() => setIsModalOpen(true)}
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
            onClose={() => setIsModalOpen(false)}
            onSubmit={handleStartFeature}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {isModalOpen && (
        <NewFeatureModal
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleStartFeature}
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
            {isSplitView && (
              <button
                type="button"
                onClick={() => setIsSplitView(false)}
                className={styles.mockBtn}
              >
                Collapse Document
              </button>
            )}
          </header>

          <div className={styles.chatWrapperOuter}>
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
              />
            ) : (
              <div className={styles.emptyState}>Loading…</div>
            )}
          </div>
        </div>

        <div className={styles.editorPane}>
          <header className={styles.paneHeader}>
            <h2 className={styles.paneTitle}>
              {documentPanelKind === "prd"
                ? "PRD Editor"
                : documentPanelKind === "inference"
                  ? "Feature inference"
                  : "Competitor analysis"}
            </h2>
            {documentPanelKind === "prd" ? (
              <button
                type="button"
                className={styles.mockBtn}
                onClick={handleSavePrd}
                disabled={savingPrd || !featureId}
              >
                {savingPrd ? "Saving..." : savedPrd ? "✓ Saved" : "Save Changes"}
              </button>
            ) : null}
          </header>
          {documentPanelKind === "prd" && streamError ? (
            <div className={styles.streamError} role="alert">
              {streamError}
            </div>
          ) : null}
          {documentPanelKind === "prd" && prdRecoveryPromptOpen && featureStatus === "generating" ? (
            <PrdRecoveryBanner
              hasDraft={prdDocument.trim().length > 0}
              busy={isLoading}
              onContinue={handlePrdRecoveryContinue}
              onRegenerate={handlePrdRecoveryRegenerate}
              onEditManually={handlePrdRecoveryEditManually}
            />
          ) : null}
          <div className={styles.editorContent}>
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
                      setSavedPrd(false);
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
