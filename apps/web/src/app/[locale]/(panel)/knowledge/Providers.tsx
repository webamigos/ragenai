'use client';

import { FilesProvider } from '@/context/FilesContext';

type Props = {
  children: React.ReactNode;
};

export const ManageKnowledgeProviders = ({ children }: Props) => {
  return (
    <FilesProvider>
      {/*
        A flex column, not a plain block. Every page under /knowledge is a
        child of this div, and the documents list hands its height down a
        chain of `min-h-0 flex-1` so that only its rows scroll. A `display:
        block` link in that chain breaks it silently: the page's `flex-1`
        resolves against nothing, the div grows to its content, and the rows
        run past the panel's edge and are clipped rather than scrolled —
        which looks like a broken table, not a broken wrapper.

        `mr-2` stays: it is the gap between the pane and the panel's edge.
      */}
      <div className="flex min-h-0 grow flex-col mr-2">{children}</div>
    </FilesProvider>
  );
};
