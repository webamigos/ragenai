'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { CopyToClipboardButton } from './CopyToClipboardButton';
import { RateAnswer } from './RateAnswer';
import { ReadAnswer } from './ReadAnswer/ReadAnswer';
import { RegenerateButton } from './RegenerateButton';
import { DurationTime } from './VoiceMode/components/DurationTime';
import { useChatViewLogic } from './useChatViewLogic';
import {
  DocumentTextIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import { getFileLabel } from '@ragenai/common-ui/utils/file-helpers';
import type {
  MessageAttachment,
  MessageDto,
  StreamedMessageDto,
} from '@/features/messages/contracts/message.types';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import type { PendingToolApproval } from '@/store/tool-approvals/toolApprovalsSlice';
import { ToolConfirmationCard } from './ToolConfirmationCard';
import { ActiveToolCalls } from '../ActiveToolCalls';
import { MarkdownWithMermaid } from './MarkdownWithMermaid';
import { SourcesBlock } from './SourcesBlock';
import { CitedSourcePreview } from './CitedSourcePreview';
import { useAppSelector } from '@/store/hooks';
import type {
  MessageRetrieval,
  RetrievalSource,
} from '@/store/assistant/assistantSlice';
import { markCitationsInHtml } from '@/features/documents/utils/citation-chips';
import './chat-response.css';

/**
 * Where an answer's `[n]` chips point, and where the sources block puts the
 * matching ids. One namespace per message, because a thread renders many
 * answers into one document and an `id` has to be unique across all of them.
 */
const anchorPrefixFor = (key: string) => `ragen-source-${key}`;

/**
 * The transform that turns `[n]` in a rendered answer into a chip, or
 * `undefined` when this turn retrieved nothing and no number could be
 * honoured.
 */
const useCitationChips = (
  retrieval: MessageRetrieval | undefined,
  anchorPrefix: string | undefined,
) => {
  const t = useTranslations('sources');

  return useMemo(() => {
    const sources = retrieval?.sources ?? [];
    if (sources.length === 0 || !anchorPrefix) {
      return undefined;
    }

    return (html: string) =>
      markCitationsInHtml(html, {
        sourceCount: sources.length,
        anchorPrefix,
        label: (n) =>
          t('chip-label', {
            number: n,
            name: sources[n - 1]?.fileName ?? sources[n - 1]?.fileId ?? '',
          }),
      });
  }, [retrieval, anchorPrefix, t]);
};

function isImageAttachment(att: MessageAttachment): boolean {
  return att.type.startsWith('image/') || att.imageData !== undefined;
}

function getImageSrc(att: MessageAttachment): string | undefined {
  return att.imageData || att.sourceUrl;
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
      >
        <XMarkIcon className="size-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/**
 * Strips [REDACTED] placeholders from reasoning content.
 * Claude's API inserts these when tool calls occur between reasoning blocks.
 */
function cleanReasoningContent(content: string): string {
  return content.replace(/\[REDACTED\]/g, '').trim();
}

const ReasoningBlock = ({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const t = useTranslations('assistant.chat');
  const { renderAndSanitize } = useChatViewLogic(null);

  const cleanedContent = cleanReasoningContent(content);

  if (!cleanedContent && !isStreaming) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-border/50 bg-muted/30 dark:bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          className={`size-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4.5 2l5 4-5 4V2z" />
        </svg>
        <span>
          {t('thinking')}
          {isStreaming ? '...' : ''}
        </span>
      </button>
      {isOpen && cleanedContent && (
        <div
          className="chat-response px-3 pb-2 text-xs text-muted-foreground/80 leading-relaxed max-h-60 overflow-y-auto"
          dangerouslySetInnerHTML={{
            __html: renderAndSanitize(cleanedContent),
          }}
        />
      )}
    </div>
  );
};

type Props = {
  messages: MessageDto[];
  isLoading: boolean;
  loadingMessage: string;
  streamedMessage: StreamedMessageDto | null;
  isPublicAccess?: boolean;
  onMessagePlayed?: (messageId: string) => void;
  voiceId?: string;
  /**
   * Threads the current thread ID into ChatOutput so the Phase 2b tool
   * confirmation card can look up its per-thread pending approval state.
   * Optional — guests / public chats don't need it.
   */
  threadId?: string;
  /**
   * Callbacks fired by the inline ToolConfirmationCard when the user
   * approves or denies a paused tool call. The parent (Assistant.tsx)
   * translates these into normal chat submissions with
   * `approvedToolCalls` set, so the SDK unpauses the tool.
   */
  onApproveToolCall?: (approval: PendingToolApproval) => void;
  onDenyToolCall?: (approval: PendingToolApproval) => void;
  onRegenerate?: () => Promise<void>;
};

function MessageTimestamp({ date }: { date?: Date | string | null }) {
  if (!date) {
    return null;
  }
  return (
    <span className="text-[0.65rem] text-muted-foreground/60">
      {format(new Date(date), 'HH:mm')}
    </span>
  );
}

/** Bubble content only — rendered inside the colored bubble div. */
const MessageBubbleContent = ({
  content,
  role,
  message,
  retrieval,
  anchorPrefix,
}: {
  content: string;
  role: string;
  message?: MessageDto;
  retrieval?: MessageRetrieval;
  anchorPrefix?: string;
}) => {
  const { renderAndSanitize } = useChatViewLogic(null);
  const transformHtml = useCitationChips(retrieval, anchorPrefix);

  return (
    <div
      className={`chat-response relative ${
        role === 'USER' ? 'user-message' : 'assistant-message'
      }`}
    >
      <MarkdownWithMermaid
        content={content}
        renderAndSanitize={renderAndSanitize}
        transformHtml={transformHtml}
      />
      {role === 'USER' &&
        message?.messageType === 'VOICE' &&
        message.voiceDurationSeconds && (
          <DurationTime messageDurationTime={message.voiceDurationSeconds} />
        )}
    </div>
  );
};

/**
 * One assistant answer: the prose, then what it was grounded in.
 *
 * The sources block lives here rather than in the map so the retrieval can be
 * read with a hook, and so the answer and the block agree on one anchor
 * namespace — a chip in the prose and the row it points at are written by the
 * same component or they drift apart.
 *
 * Two places a retrieval can come from, and the store wins. A turn that just
 * streamed knows its chunk count, its duration and its relevance scores; a
 * turn read back from the database knows the documents and which of them were
 * cited, because that is all `document_retrievals` keeps. Preferring the
 * store means a live answer never loses detail to the thinner copy that
 * arrives when the thread is refetched around it.
 *
 * Neither one means the answer's `[n]` stay plain text — which is the honest
 * result, since there would be nothing for a chip to link to.
 */
const AssistantAnswer = ({
  message,
  isPublicAccess,
}: {
  message: MessageDto;
  /**
   * A read-only view: a public share, a guest thread, or a shared thread
   * opened read-only.
   *
   * The source cards stay, because what the answer was grounded in is worth
   * showing to anyone who can read the answer. What goes is the *control*:
   * `/api/files/{id}` needs a session and the file's own access check, so on a
   * public route the panel would open onto "Failed to load file." A card that
   * clicks into nothing is worse than one that does not invite the click.
   */
  isPublicAccess: boolean;
}) => {
  const liveRetrieval = useAppSelector(
    (state) => state.assistant.retrievalByMessage[message.id],
  );
  const retrieval = liveRetrieval ?? message.retrieval;
  const anchorPrefix = anchorPrefixFor(message.id);
  /*
    Which source is open, per answer. Per answer rather than per thread because
    a thread renders many of these and the panel belongs to the one that was
    clicked — hoisting it would mean two answers racing for one slot.

    The whole source, not its id: it carries the page and the regions the
    preview places the view with, and looking them up again from an id would
    be a second copy of a fact that is already here.
  */
  const [openSource, setOpenSource] = useState<RetrievalSource | null>(null);

  return (
    <>
      <MessageBubbleContent
        content={message.content}
        role={message.role}
        message={message}
        retrieval={retrieval}
        anchorPrefix={anchorPrefix}
      />
      {retrieval ? (
        <SourcesBlock
          retrieval={retrieval}
          idPrefix={anchorPrefix}
          onActivate={isPublicAccess ? undefined : setOpenSource}
        />
      ) : null}
      <CitedSourcePreview
        source={openSource}
        onClose={() => setOpenSource(null)}
      />
    </>
  );
};

/** Action buttons + timestamp — rendered outside the bubble, visible on hover. */
const MessageActions = ({
  content,
  role,
  message,
  voiceId,
  isPublicAccess,
  isLast,
  onRegenerate,
  isLoading,
}: {
  content: string;
  role: string;
  message: MessageDto;
  voiceId?: string;
  isPublicAccess: boolean;
  isLast: boolean;
  onRegenerate: () => Promise<void>;
  isLoading: boolean;
}) => {
  const { renderAndSanitize } = useChatViewLogic(null);
  const renderedHtml = renderAndSanitize(content);

  return (
    <div
      className={`flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
        role === 'USER' ? 'justify-end' : 'justify-start'
      }`}
    >
      <MessageTimestamp date={message.createdAt} />
      {role === 'ASSISTANT' && (
        <>
          <RateAnswer initialRated={message.rate} messageId={message.id} />
          <CopyToClipboardButton message={message} htmlContent={renderedHtml} />
          {!isPublicAccess && (
            <ReadAnswer
              content={content}
              voiceId={voiceId!}
              messageId={message.id}
            />
          )}
          {!isPublicAccess && isLast && (
            <RegenerateButton
              onRegenerate={onRegenerate}
              disabled={isLoading}
            />
          )}
        </>
      )}
      {role === 'USER' && (
        <CopyToClipboardButton message={message} htmlContent={renderedHtml} />
      )}
    </div>
  );
};

export const ChatOutput = ({
  messages,
  isLoading,
  loadingMessage = '',
  streamedMessage,
  isPublicAccess = false,
  voiceId,
  threadId,
  onApproveToolCall,
  onDenyToolCall,
  onRegenerate,
}: Props) => {
  const { renderedStreamedMessage } = useChatViewLogic(streamedMessage);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  // Phase 2b — pending approval for the current thread (if any). The
  // card is rendered inline inside the last assistant message bubble
  // when this is set.
  const pendingApproval = useSelector((state: RootState) =>
    threadId ? state.toolApprovals.pendingByThread[threadId] : undefined,
  );
  const lastAssistantMessageIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'ASSISTANT') {
        return i;
      }
    }
    return -1;
  })();

  return (
    <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex flex-col gap-2">
        {messages.map((message, messageIndex) => (
          <div key={`message-${message.id}-${messageIndex}`}>
            {message.role === 'USER' &&
              message.attachments &&
              message.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2 justify-end">
                  {message.attachments.map((att, i) => {
                    const imgSrc = isImageAttachment(att)
                      ? getImageSrc(att)
                      : undefined;

                    if (isImageAttachment(att)) {
                      if (imgSrc) {
                        return (
                          <button
                            key={`${att.name}-${i}`}
                            type="button"
                            onClick={() =>
                              setLightboxImage({ src: imgSrc, alt: att.name })
                            }
                            className="group relative w-40 overflow-hidden rounded-xl border border-border bg-background transition-colors hover:border-primary/50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgSrc}
                              alt={att.name}
                              className="h-24 w-full object-cover"
                            />
                            <div className="px-2 py-1.5">
                              <span
                                className="block text-xs leading-snug line-clamp-1 text-foreground"
                                title={att.name}
                              >
                                {att.name}
                              </span>
                            </div>
                          </button>
                        );
                      }

                      // Image attachment without stored data (legacy messages)
                      return (
                        <div
                          key={`${att.name}-${i}`}
                          className="flex flex-col gap-2 w-40 rounded-xl border border-border bg-background p-3 text-foreground"
                        >
                          <span
                            className="text-sm leading-snug line-clamp-3"
                            title={att.name}
                          >
                            {att.name}
                          </span>
                          <span className="inline-flex items-center gap-1 self-start rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                            <PhotoIcon className="size-3 text-ready" />
                            {getFileLabel(att.name)}
                          </span>
                        </div>
                      );
                    }

                    const cardContent = (
                      <>
                        <span
                          className="text-sm leading-snug line-clamp-3"
                          title={att.name}
                        >
                          {att.name}
                        </span>
                        <span className="inline-flex items-center gap-1 self-start rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                          <DocumentTextIcon className="size-3 text-primary" />
                          {getFileLabel(att.name)}
                        </span>
                      </>
                    );

                    const baseClass =
                      'flex flex-col gap-2 w-40 rounded-xl border border-border bg-background p-3 text-foreground';

                    if (att.sourceUrl) {
                      return (
                        <a
                          key={`${att.name}-${i}`}
                          href={att.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${baseClass} hover:bg-muted/50 transition-colors no-underline`}
                        >
                          {cardContent}
                        </a>
                      );
                    }

                    return (
                      <div key={`${att.name}-${i}`} className={baseClass}>
                        {cardContent}
                      </div>
                    );
                  })}
                </div>
              )}
            {message.content.trim() && (
              <div
                className={`group ${
                  message.role === 'USER'
                    ? 'ml-auto max-w-[85%]'
                    : 'mr-auto max-w-[90%]'
                }`}
              >
                {message.role === 'ASSISTANT' &&
                  message.metadata?.reasoningContent &&
                  cleanReasoningContent(message.metadata.reasoningContent) && (
                    <ReasoningBlock
                      content={message.metadata.reasoningContent}
                    />
                  )}
                <div
                  className={`relative rounded-2xl px-4 py-3 text-[0.9375rem] leading-relaxed ${
                    message.role === 'USER'
                      ? 'bg-muted dark:bg-muted/50 text-foreground rounded-br-md'
                      : 'bg-muted dark:bg-muted/50 text-foreground rounded-bl-md'
                  }`}
                >
                  {message.role === 'ASSISTANT' ? (
                    <AssistantAnswer
                      message={message}
                      isPublicAccess={isPublicAccess}
                    />
                  ) : (
                    <MessageBubbleContent
                      content={message.content}
                      role={message.role}
                      message={message}
                    />
                  )}
                </div>
                <MessageActions
                  content={message.content}
                  role={message.role}
                  message={message}
                  isPublicAccess={isPublicAccess}
                  voiceId={!isPublicAccess ? voiceId : undefined}
                  isLast={messageIndex === lastAssistantMessageIndex}
                  onRegenerate={onRegenerate ?? (() => Promise.resolve())}
                  isLoading={isLoading}
                />
                {/* Phase 2b — inline tool confirmation card on the last
                    assistant message when the SDK paused a write tool. */}
                {pendingApproval &&
                  messageIndex === lastAssistantMessageIndex &&
                  message.role === 'ASSISTANT' &&
                  onApproveToolCall &&
                  onDenyToolCall && (
                    <ToolConfirmationCard
                      approval={pendingApproval}
                      onApprove={onApproveToolCall}
                      onDeny={onDenyToolCall}
                      disabled={isLoading}
                    />
                  )}
              </div>
            )}
          </div>
        ))}
        {/*
          Live tool-call chips — rendered above the streaming bubble so
          the user sees "Using Rejestr.io…" before any content starts
          streaming. Returns null when there's nothing active, so it
          doesn't shift layout when idle. threadId fallback to empty
          string to satisfy the non-null prop signature — the selector
          just returns an empty array in that case.
        */}
        {threadId && <ActiveToolCalls threadId={threadId} />}
        {streamedMessage &&
          (streamedMessage.content ||
            (streamedMessage.reasoningContent &&
              cleanReasoningContent(streamedMessage.reasoningContent))) && (
            <div className="group relative mr-auto max-w-[90%] rounded-2xl rounded-bl-md bg-muted dark:bg-muted/50 px-4 py-3 text-foreground text-[0.9375rem] leading-relaxed">
              {streamedMessage.reasoningContent && (
                <ReasoningBlock
                  content={streamedMessage.reasoningContent}
                  isStreaming={streamedMessage.isReasoning}
                />
              )}
              {/*
                No citation chips while streaming. The transform parses the
                whole answer, and the answer is re-rendered on every token, so
                chipping here costs a full parse per chunk and grows with the
                message. The markers stay as `[1]` until the turn settles,
                which is also when the retrieval is attached to the message
                and a chip finally has somewhere to point.
              */}
              <div className="chat-response">
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderedStreamedMessage,
                  }}
                />
              </div>
            </div>
          )}
        {isLoading &&
          (!streamedMessage ||
            (!streamedMessage.content &&
              !(
                streamedMessage.reasoningContent &&
                cleanReasoningContent(streamedMessage.reasoningContent)
              ))) && (
            <div className="mr-auto flex items-center gap-2.5 rounded-2xl rounded-bl-md bg-muted/60 dark:bg-muted/30 px-4 py-3">
              <div className="flex gap-1">
                <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
              </div>
              {loadingMessage && (
                <span className="text-xs text-muted-foreground/70">
                  {loadingMessage}
                </span>
              )}
            </div>
          )}
      </div>
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
};
