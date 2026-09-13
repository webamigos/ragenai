'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { fetchMessagesFromApi } from '@/app/lib/services/api';
import { ChatOutput } from '@/app/components/Assistant/ChatOutput/ChatOutput';
import type { MessageDto } from '@/features/messages/contracts/message.types';

type Props = {
  params: Promise<{ threadId: string }>;
};

export default function ReadOnlyThreadPage({ params }: Props) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const visitorId = searchParams.get('vid');
  const t = useTranslations('projects.project-view');

  useEffect(() => {
    params.then(({ threadId: tid }) => setThreadId(tid));
  }, [params]);

  useEffect(() => {
    if (!threadId || !visitorId) {
      setIsLoading(false);
      return;
    }

    const loadMessages = async () => {
      setIsLoading(true);
      try {
        const response = await fetchMessagesFromApi(threadId, visitorId);
        if (response?.data) {
          setMessages(response.data.messages);
          if (response.data.threadContext?.project?.id) {
            setProjectId(response.data.threadContext.project.id);
          }
        }
      } catch {
        setMessages([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [threadId, visitorId]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {projectId && (
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" />
            {t('back-to-assistant')}
          </Link>
        )}
        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ml-auto">
          {t('read-only')}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <ChatOutput
          messages={messages}
          isLoading={isLoading}
          loadingMessage=""
          streamedMessage={null}
          isPublicAccess={true}
          /*
            Read-only chrome, but a real session: this route is inside the
            `(panel)` layout, which resolves the current user and redirects to
            sign-in without one. So `/api/files/{id}` works for this reader and
            a cited source can be opened — unlike on `/public`, where there is
            no session and the panel would only show "Failed to load file."
          */
          canOpenSources={true}
        />
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
