"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FeatureIssue } from "@/lib/database.types";
import {
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_STATUS_OPTIONS,
  issuePriorityLabel,
  issueStatusLabel,
} from "@/lib/issueFieldLabels";
import styles from "./IssueDetailLayout.module.css";

export type IssueDetailIssue = Pick<
  FeatureIssue,
  | "id"
  | "issue_key"
  | "type"
  | "title"
  | "description"
  | "acceptance_criteria"
  | "status"
  | "priority"
  | "due_date"
>;

type Props = {
  workspaceId: string;
  workspaceName: string;
  featureName: string;
  featureId: string;
  issue: IssueDetailIssue;
  parentEpic: IssueDetailIssue | null;
  childStories: IssueDetailIssue[];
  onSelectIssue: (id: string) => void;
  onPatch: (patch: {
    status?: FeatureIssue["status"];
    priority?: FeatureIssue["priority"];
    due_date?: string | null;
  }) => Promise<void>;
};

export default function IssueDetailLayout({
  workspaceId,
  workspaceName,
  featureName,
  featureId,
  issue,
  parentEpic,
  childStories,
  onSelectIssue,
  onPatch,
}: Props) {
  const dueValue = issue.due_date
    ? issue.due_date.slice(0, 10)
    : "";

  return (
    <div className={styles.root}>
      <div className={styles.main}>
        <h1 className={styles.title}>{issue.title}</h1>

        <h2 className={styles.sectionTitle}>Description</h2>
        <div className={styles.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {issue.description?.trim() || "_No description._"}
          </ReactMarkdown>
        </div>

        {issue.acceptance_criteria && issue.acceptance_criteria.length > 0 ? (
          <>
            <h2 className={styles.sectionTitle}>Acceptance criteria</h2>
            <ol className={styles.acList}>
              {issue.acceptance_criteria.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </>
        ) : null}

        {issue.type === "epic" && childStories.length > 0 ? (
          <div className={styles.childrenSection}>
            <h3 className={styles.childrenTitle}>Child stories</h3>
            {childStories.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.childRow}
                onClick={() => onSelectIssue(s.id)}
              >
                <span className={styles.childMeta}>
                  {s.issue_key} · Story
                </span>
                {s.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <aside className={styles.rail} aria-label="Issue details">
        <div className={styles.railRow}>
          <span className={styles.railLabel}>Status</span>
          <select
            className={styles.select}
            value={issue.status}
            onChange={async (e) => {
              await onPatch({ status: e.target.value as FeatureIssue["status"] });
            }}
          >
            {ISSUE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {issueStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.railRow}>
          <span className={styles.railLabel}>Priority</span>
          <select
            className={styles.select}
            value={issue.priority}
            onChange={async (e) => {
              await onPatch({ priority: e.target.value as FeatureIssue["priority"] });
            }}
          >
            {ISSUE_PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {issuePriorityLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.railRow}>
          <span className={styles.railLabel}>Due date</span>
          <input
            type="date"
            className={styles.dateInput}
            value={dueValue}
            onChange={async (e) => {
              const v = e.target.value;
              await onPatch({ due_date: v ? v : null });
            }}
          />
        </div>

        {issue.type === "story" && parentEpic ? (
          <div className={styles.railRow}>
            <span className={styles.railLabel}>Parent</span>
            <button
              type="button"
              className={styles.parentLink}
              onClick={() => onSelectIssue(parentEpic.id)}
            >
              <span className={styles.parentKey}>{parentEpic.issue_key}</span>
              <span>{parentEpic.title}</span>
            </button>
          </div>
        ) : null}

        <div className={styles.railRow}>
          <span className={styles.railLabel}>Workspace</span>
          <span className={styles.metaValue}>{workspaceName}</span>
        </div>

        <div className={styles.railRow}>
          <span className={styles.railLabel}>Feature</span>
          <span className={styles.metaValue}>{featureName}</span>
        </div>

        <Link
          href={`/workspaces/${workspaceId}?feature=${featureId}`}
          className={styles.featureLink}
        >
          Open feature workspace
        </Link>
      </aside>
    </div>
  );
}
