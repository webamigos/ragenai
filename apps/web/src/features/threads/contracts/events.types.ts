import { type Message, type Thread } from '@/generated/prisma/browser';
import {
  type ApiMessageDto,
  type MessageDto,
} from '@/features/messages/contracts/message.types';
import type { ChainErrorCode } from '@/libs/chains/types/errors';
import type { SourceRegion } from '@ragenai/rag-core';

export type SseInitEvent = {
  type: 'init';
};

export type SseMessageEvent = {
  type: 'message';
  payload: MessageDto;
};

export type ApiSseMessageEvent = ApiMessageDto;

export type SseMessageDelta = {
  type: 'delta';
  payload: {
    content: string;
  };
};

export type ApiSseMessageDelta = {
  content: string;
};

export type ApiSseReasoningDelta = {
  content: string;
};

export type ApiSseThreadFound = {
  id: Thread['id'];
};

export type ApiSseMessageCreated = {
  id: Message['id'];
};

/**
 * One file the model was shown this turn.
 *
 * Grown one optional field at a time, each with its own decision behind it —
 * `relevanceScore` is gap 4. Every one of them is absent rather than defaulted
 * when the thing it describes was not measured, which is the rule that keeps
 * this from repeating `page_number`: a field is only present when it holds
 * something true.
 */
export type ApiSseRetrievedSource = {
  fileId: string;
  /** Null on chunks ingested before file names were stored in metadata. */
  fileName: string | null;
  /**
   * The reranker's relevance for this file's best chunk, 0–1.
   *
   * Absent on a default installation: reranking is opt-in, so most deployments
   * produce no score at all. Absence means "not measured", never "scored
   * zero" — the UI draws no bar rather than an empty one.
   */
  relevanceScore?: number;
  /**
   * The page this file's best chunk came from, 1-based.
   *
   * Absent whenever the parser could not say — a legacy loader, an
   * unpaginated format, or a chunk Docling could not match to an element. The
   * sources block renders "· page {n}" only when it is here, so a document
   * ingested before the field existed carries no page rather than a wrong
   * one. Do not default it; a re-index is what gives an old document pages.
   */
  sourcePage?: number;
  /**
   * How many of this file's chunks the model was shown, at least 1.
   *
   * Every other field here describes the file's *best* chunk. This one says
   * how much of the file was read, which is what separates a document the
   * answer leaned on from one it glanced at — the sources rail's whole reason
   * to exist.
   */
  chunkCount: number;
  /**
   * The distinct pages those chunks came from, ascending.
   *
   * Absent, never empty, when no chunk carried a page — same rule as
   * `sourcePage`, and for the same reason: an empty array reads as "came from
   * no pages" where the truth is "the parser could not say". `pages[0]` is not
   * `sourcePage`; the best chunk is often not the lowest-numbered one.
   */
  pages?: number[];
  /**
   * Where on its page the quoted passage sits, as top-left-origin fractions of
   * the page box, 0–1.
   *
   * From the same chunk as `relevanceScore`, `sourcePage` and `snippet`, so a
   * highlight points at what the card quotes. Normalised by the worker at
   * ingest, so a viewer needs neither the page size nor the parser's
   * coordinate origin — `left: {x * 100}%` over the rendered page box is
   * correct at any zoom.
   *
   * Absent, never empty, whenever the parser gave no box. A re-index is what
   * gives an old document regions.
   */
  sourceRegions?: SourceRegion[];
  /**
   * The passage this file contributed — what the model actually read, so the
   * source card can quote it.
   *
   * Taken from the same chunk as the score and the page, never assembled from
   * two. Absent when the chunk had no text.
   *
   * This used to be withheld deliberately: `toRetrievalEventSource` existed
   * because the chain's object carried up to 2 kB of document text per source
   * that no client read. Now one does, and the same text already reaches this
   * browser on the messages route for any thread it reopens.
   */
  snippet?: string;
};

/**
 * What retrieval did, sent **before the first `delta`** so the row above the
 * answer can render while the answer is still streaming. Retrieval finishes
 * before the model is called, so this costs nothing to send early.
 *
 * The event is emitted only when retrieval actually ran. Its **absence** means
 * the knowledge base was never searched — a conversation-mode turn, or a
 * thread scoped to `MODEL_ONLY`. A turn that searched and found nothing does
 * emit it, with no sources and a `chunkCount` of zero, because "found nothing"
 * is an answer about the knowledge base and "did not look" is not.
 */
export type ApiSseRetrieval = {
  sources: ApiSseRetrievedSource[];
  /** Chunks put in front of the model; not the same as `sources.length`. */
  chunkCount: number;
  durationMs: number;
};

/**
 * Which of the retrieved files the finished answer actually cited, sent after
 * generation because it is decided from the answer text.
 *
 * Carries ids only: the client already has the names from `retrieval`, and
 * sending them twice invites the two copies to disagree.
 */
export type ApiSseCitations = {
  fileIds: string[];
};

export type SseMessageError = {
  type: 'error';
  message: string;
  originalErrorMessage?: string;
  code: ChainErrorCode;
};

export type ApiSseToolCall = {
  toolCallId: string;
  toolName: string;
};

export type ApiSseToolResult = {
  toolCallId: string;
  toolName: string;
};

/**
 * Emitted when the AI SDK pauses a write tool because its `needsApproval`
 * predicate returned true — Phase 2 prompt-injection gating. The client
 * currently renders a plain inline message ("this action requires
 * confirmation"); Phase 2b will upgrade this to a modal approval card.
 */
export type ApiSseToolApprovalRequest = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  provider: string;
};

export type SseEndEvent = {
  type: 'end';
};
