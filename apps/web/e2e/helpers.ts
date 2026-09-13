import { type Page } from '@playwright/test';

import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './constants';

export const CREDENTIALS = {
  email: TEST_USER_EMAIL,
  password: TEST_USER_PASSWORD,
} as const;

export const ROUTES = {
  signIn: '/pl/sign-in',
  signUp: '/pl/sign-up',
  forgotPassword: '/pl/forgot-password',
  home: '/pl',
  newChat: '/pl/new',
  chats: '/pl/chats',
  assistants: '/pl/assistants',
  knowledgeUpload: '/pl/knowledge/upload-files',
  knowledgeDocuments: '/pl/knowledge/documents-list',
  knowledgeCreate: '/pl/knowledge/create-document',
  knowledgeFromUrl: '/pl/knowledge/add-from-url',
  projects: '/pl/projects',
  userProfile: '/pl/user/profile',
  settingsGeneral: '/pl/settings/general',
  settingsAccount: '/pl/settings/account',
  settingsConnectors: '/pl/settings/connectors',
  settingsOrganization: '/pl/organization/profile',
  settingsPromptManagement: '/pl/organization/assistant-settings',
  settingsSubscription: '/pl/organization/subscription',
  settingsTeams: '/pl/organization/teams',
  organizationAiUsage: '/pl/organization/ai-usage',
  organizationDiskUsage: '/pl/organization/disk-usage',
  organizationChatbots: '/pl/organization/chatbots',
  notifications: '/pl/notifications',
  publicAssistant: (accessToken: string) =>
    `/pl/public/assistants/${accessToken}`,
} as const;

export const LABELS = {
  signOut: /wyloguj się/i,
  newThread: /nowy wątek/i,
  emailInvalid: /nieprawidłowy adres email/i,
  passwordTooShort: /hasło musi mieć co najmniej 8 znaków/i,
  send: /wyślij/i,
  uploadSuccess: /pliki zostały wgrane/i,
  projectFileUploaded: /plik został wgrany/i,
  chooseFiles: /wybierz pliki z dysku/i,
  // Thread actions
  threadDelete: /usuń/i,
  threadRename: /zmień nazwę/i,
  threadStar: /przypnij/i,
  threadDeleteTitle: /usuń wątek/i,
  threadRenameTitle: /zmień nazwę wątku/i,
  cancel: /anuluj/i,
  save: /zapisz/i,
  // Projects
  createProject: /nowy asystent/i,
  createProjectSubmit: /stwórz/i,
  projectCreated: /asystent został pomyślnie utworzony/i,
  projectInstructions: /instrukcje/i,
  instructionsSaved: /instrukcja została zapisana/i,
  // Knowledge base
  deleteFile: /usuń/i,
  deleteFileTitle: /usuń plik/i,
  addFromUrlSubmit: /załaduj wiedzę/i,
  urlLoaded: /wiedza pobrana pomyślnie/i,
  // Thread actions (continued)
  threadUnstar: /odepnij/i,
  threadShare: /udostępnij/i,
  // Organization members
  inviteMember: /zaproś użytkownika/i,
  sendInvitation: /wyślij zaproszenie/i,
  changeToAdmin: /zmień na administratora/i,
  changeToMember: /zmień na użytkownika/i,
  removeMember: /usuń/i,
  confirmRemoveMember: /czy na pewno chcesz usunąć tego użytkownika/i,
  membersTab: /użytkownicy/i,
  invitationsTab: /zaproszenia/i,
  generalTab: /ogólne/i,
  // Connectors
  connectorsTitle: /integracje/i,
  connect: /połącz/i,
  disconnect: /rozłącz/i,
  apiKeyPlaceholder: /wprowadź klucz api/i,
  // Public/shared access
  shareKnowledge: /udostępnij wiedzę asystenta/i,
  sharePublicly: /udostępnij wiedzę asystenta publicznie/i,
  copyLink: /kopiuj link publiczny/i,
  disablePublicAccess: /wyłącz dostęp publiczny/i,
  shareThread: /udostępnij wątek/i,
  shareThreadSave: /zapisz/i,
  shareThreadSuccess: /udostępnianie wątku zaktualizowane/i,
  // Search
  searchPlaceholder: /szukaj czatów i asystentów/i,
  searchNoResults: /brak wyników/i,
  // Support wizard
  wizardTitle: /jak możemy pomóc/i,
  bug: /bug/i,
  question: /pytanie|question/i,
  suggestion: /sugestia|suggestion/i,
} as const;

/**
 * Log in via the UI and wait for redirect.
 * Login uses window.location.href (hard navigation), allow extra time.
 */
export async function login(page: Page) {
  await page.goto(ROUTES.signIn);
  await page.locator('input[type="email"]').fill(CREDENTIALS.email);
  await page.locator('input[type="password"]').fill(CREDENTIALS.password);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL('**/pl/new', { timeout: 15_000 });
}

/**
 * Re-login and save fresh auth state.
 * Call in beforeAll when session may have been invalidated by earlier tests
 * (e.g., org switching rotates the session token).
 */
export async function reLogin(browser: import('@playwright/test').Browser) {
  const { PrismaClient } = await import('../src/generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { TEST_USER_ID, TEST_ORG_ID, AUTH_FILE } =
    await import('./constants.js');

  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to sign-in — if already logged in, it redirects to /new
  await page.goto(ROUTES.signIn);
  const isOnSignIn = await page
    .locator('input[type="email"]')
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (isOnSignIn) {
    await login(page);
  } else {
    // Already logged in — just ensure we're on a valid page
    await page.waitForURL('**/pl/**', { timeout: 10_000 });
  }

  // Ensure activeOrganizationId is set
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.session.updateMany({
      where: { userId: TEST_USER_ID },
      data: { activeOrganizationId: TEST_ORG_ID },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Save fresh cookies
  await context.storageState({ path: AUTH_FILE });
  await context.close();
}

export interface BuildMockSSEOptions {
  userMessageId?: string;
  assistantMessageId?: string;
  content: string;
  /**
   * What retrieval found, sent before the first token the way the real stream
   * sends it.
   *
   * Omitted by default, because a turn that never searched the knowledge base
   * emits no such event at all and most of these tests are about the answer
   * rather than about its sources. Shape:
   * `src/features/threads/contracts/events.types.ts`.
   */
  retrieval?: {
    sources: Array<{
      fileId: string;
      fileName: string | null;
      chunkCount: number;
      sourcePage?: number;
      snippet?: string;
      sourceRegions?: Array<{
        page: number;
        x: number;
        y: number;
        w: number;
        h: number;
      }>;
    }>;
    chunkCount: number;
    durationMs: number;
  };
  /** File ids the answer cited, sent after generation the way the real stream does. */
  citedFileIds?: string[];
}

/**
 * Build a mock SSE response body matching the real streaming contract.
 *
 * Event sequence: user_message_created → delta(s) → final_response → close
 * See src/features/threads/contracts/events.types.ts for payload shapes.
 */
export function buildMockSSE(options: BuildMockSSEOptions): string {
  const {
    userMessageId = 'mock-user-msg-001',
    assistantMessageId = 'mock-assistant-msg-001',
    content,
    retrieval,
    citedFileIds,
  } = options;

  const events = [
    `event: user_message_created\ndata: ${JSON.stringify({ id: userMessageId })}\n\n`,
    // Before the first delta, as the real stream does: retrieval finishes
    // before the model is called, so the sources row can render while the
    // answer is still streaming.
    ...(retrieval
      ? [`event: retrieval\ndata: ${JSON.stringify(retrieval)}\n\n`]
      : []),
    ...content
      .split(' ')
      .map(
        (word, i) =>
          `event: delta\ndata: ${JSON.stringify({ content: (i > 0 ? ' ' : '') + word })}\n\n`,
      ),
    // After generation, because which sources were cited is decided from the
    // answer text.
    ...(citedFileIds
      ? [
          `event: citations\ndata: ${JSON.stringify({ fileIds: citedFileIds })}\n\n`,
        ]
      : []),
    `event: final_response\ndata: ${JSON.stringify({ id: assistantMessageId, role: 'ASSISTANT', runId: 'mock-run-001' })}\n\n`,
    `event: close\ndata: {}\n\n`,
  ];
  return events.join('');
}

function isChatStreamRequest(request: {
  method(): string;
  url(): string;
}): boolean {
  const { pathname } = new URL(request.url());
  return (
    request.method() === 'POST' && /^\/api\/threads\/[^/]+\/?$/.test(pathname)
  );
}

/**
 * Intercepts the real chat-streaming endpoint (`POST /api/threads/:threadId`,
 * see `handleAssistantStream`'s `getStreamUrl`) and fulfills it with a mock
 * SSE body via `buildMockSSE`, without touching sibling routes on the same
 * resource (`/export`, `/context`, `/model`) or the `GET` messages fetch.
 *
 * Must be called before the UI action that triggers the request (Playwright
 * route handlers only apply to requests made after registration).
 */
export async function mockChatStream(
  page: Page,
  options: BuildMockSSEOptions,
): Promise<void> {
  await page.route('**/api/threads/**', async (route) => {
    if (!isChatStreamRequest(route.request())) {
      return route.continue();
    }

    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: buildMockSSE(options),
    });
  });
}

/**
 * Same as `mockChatStream`, but serves a different canned response per
 * sequential chat-stream request — for exercising multi-turn conversations,
 * where each turn must get its own reply. Once `responses` is exhausted, the
 * last entry is reused for any further request.
 *
 * NOTE: the client's request body does NOT carry prior chat history (the
 * server derives it from `threadId` against the DB) — this only controls
 * what each turn's *response* looks like, so "does turn 2 forget turn 1"
 * must be asserted by checking both exchanges are still on screen, not by
 * inspecting the outgoing request.
 */
export async function mockChatStreamSequence(
  page: Page,
  responses: BuildMockSSEOptions[],
): Promise<void> {
  let turn = 0;
  await page.route('**/api/threads/**', async (route) => {
    if (!isChatStreamRequest(route.request())) {
      return route.continue();
    }

    const options = responses[Math.min(turn, responses.length - 1)];
    turn += 1;

    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: buildMockSSE(options),
    });
  });
}
