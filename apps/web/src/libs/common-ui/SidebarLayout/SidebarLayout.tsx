/*
 * The panel shell. Moved out of libs/tui because it is not the kit's:
 * no @headlessui/react aliasing anywhere in it, and its collapse context,
 * localStorage persistence and collapsed icon rail have no counterpart in the
 * component set that directory held. Two commits in this repository's history
 * shaped it, and more of it is ours than theirs.
 *
 * The same reason as Skeleton and EmptyState: libs/tui carried a LICENSE
 * saying its files were third-party and could not be redistributed apart from
 * Ragen, and our own code did not belong under that. The directory itself is
 * gone now — ADR-41 finished — but this is why the file is here.
 *
 * Behaviour is untouched by the move. The width and height rules it carries
 * were reasoned about separately — see the comments inside.
 */
'use client';

import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import React, { useState, useCallback, createContext, useContext } from 'react';
import { NavbarItem } from '../Navbar';

const SidebarCollapseContext = createContext({
  isCollapsed: false,
  toggle: () => {},
});

export function useSidebarCollapse() {
  return useContext(SidebarCollapseContext);
}

const SidebarMobileContext = createContext({
  isOpen: false,
  openSidebar: () => {},
  closeSidebar: () => {},
});

export function useMobileSidebar() {
  return useContext(SidebarMobileContext);
}

function OpenMenuIcon() {
  return (
    <svg
      data-slot="icon"
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="w-6 h-6"
      fill="currentColor"
    >
      <path d="M2 6.75C2 6.33579 2.33579 6 2.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.16421 17.6642 7.5 17.25 7.5H2.75C2.33579 7.5 2 7.16421 2 6.75ZM2 13.25C2 12.8358 2.33579 12.5 2.75 12.5H17.25C17.6642 12.5 18 12.8358 18 13.25C18 13.6642 17.6642 14 17.25 14H2.75C2.33579 14 2 13.6642 2 13.25Z" />
    </svg>
  );
}

function CloseMenuIcon() {
  return (
    <svg
      data-slot="icon"
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="w-6 h-6"
      fill="currentColor"
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

function SidebarToggleIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="w-5 h-5"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function MobileSidebar({
  open,
  close,
  children,
}: React.PropsWithChildren<{ open: boolean; close: () => void }>) {
  return (
    <Dialog open={open} onClose={close} className="lg:hidden">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />
      <DialogPanel
        transition
        className="fixed inset-y-0 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
      >
        <div className="flex h-full flex-col rounded-lg bg-card shadow-2xs ring-1 ring-border">
          <div className="-mb-3 px-4 pt-3">
            {/*
              Headless UI's `CloseButton` used to supply the dismiss, which
              meant the drawer closed through a mechanism nothing in this file
              named. `NavbarItem` is a plain button now, so the handler is
              written out — the same change the sidebar primitives made to
              `SidebarItem` in #930.
            */}
            <NavbarItem onClick={close} aria-label="Close navigation">
              <CloseMenuIcon />
            </NavbarItem>
          </div>
          {children}
        </div>
      </DialogPanel>
    </Dialog>
  );
}

export function SidebarLayout({
  navbar,
  sidebar,
  collapsedSidebar,
  children,
}: React.PropsWithChildren<{
  navbar: React.ReactNode;
  sidebar: React.ReactNode;
  collapsedSidebar?: React.ReactNode;
}>) {
  const [showSidebar, setShowSidebar] = useState(false);

  const openSidebar = useCallback(() => setShowSidebar(true), []);
  const closeSidebar = useCallback(() => setShowSidebar(false), []);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar-collapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <SidebarMobileContext.Provider
      value={{ isOpen: showSidebar, openSidebar, closeSidebar }}
    >
      <SidebarCollapseContext.Provider value={{ isCollapsed, toggle }}>
        <div className="relative isolate flex min-h-svh w-full bg-card max-lg:flex-col lg:bg-background">
          {/* Sidebar on desktop */}
          <div
            className={`fixed inset-y-0 left-0 max-lg:hidden transition-all duration-200 ${isCollapsed ? 'w-0 overflow-hidden' : 'w-64'}`}
          >
            {sidebar}
          </div>

          {/* Collapsed icon rail on desktop */}
          {collapsedSidebar && (
            <div
              className={`fixed inset-y-0 left-0 z-20 max-lg:hidden transition-all duration-200 ${isCollapsed ? 'w-12' : 'w-0 overflow-hidden'}`}
            >
              {collapsedSidebar}
            </div>
          )}

          {/* Sidebar on mobile */}
          <MobileSidebar open={showSidebar} close={closeSidebar}>
            {sidebar}
          </MobileSidebar>

          {/* Navbar on mobile */}
          <header className="flex items-center px-4 border-b border-sidebar-border lg:hidden">
            <div className="py-2.5">
              <NavbarItem onClick={openSidebar} aria-label="Open navigation">
                <OpenMenuIcon />
              </NavbarItem>
            </div>
            <div className="min-w-0 flex-1">{navbar}</div>
          </header>

          {/* Content */}
          <main
            className={`flex flex-1 flex-col pb-2 lg:min-w-0 lg:pt-2 lg:pr-2 transition-all duration-200 ${(() => {
              if (!isCollapsed) {
                return 'lg:pl-64';
              }
              return collapsedSidebar ? 'lg:pl-12' : 'lg:pl-0';
            })()}`}
          >
            {/* Desktop sidebar toggle (only when no collapsed rail) */}
            {isCollapsed && !collapsedSidebar && (
              <button
                type="button"
                onClick={toggle}
                className="fixed top-3 left-3 z-30 max-lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-paper-200 dark:hover:bg-muted transition-colors"
                aria-label="Open sidebar"
              >
                <SidebarToggleIcon />
              </button>
            )}
            <div
              /*
                `panel-content-shell` and `panel-content-wrapper` below are
                the two halves of the full-width opt-in. A page marks itself
                with `data-panel-fullwidth` and `global.css` keys off that
                descendant to drop the cap on the wrapper and the 40px
                padding here. Both hooks are needed because the cap lives on
                the child and the padding on the parent.
              */
              className={`panel-content-shell flex items-stretch justify-center min-h-[calc(100vh-4rem)] lg:min-h-[calc(100vh-1rem)] p-4 sm:p-6 lg:bg-card lg:p-10 lg:ring-1 lg:ring-border ${isCollapsed && collapsedSidebar ? 'lg:rounded-r-lg' : 'lg:rounded-lg'}`}
            >
              {/*
                The shell's cap is a *backstop*, not the reading measure. Every
                page that needs a comfortable line length already sets its own —
                settings pages use max-w-2xl…5xl, the chat uses max-w-3xl/4xl
                with mx-auto — so a tight cap here never protects prose. It only
                squeezes the data-dense pages that have no reason to be narrow:
                the knowledge base list, the documents table, the usage tables,
                which then scroll horizontally on a monitor with room to spare.

                Relaxed only from 2xl up. Below that the viewport minus the
                sidebar is narrower than max-w-6xl anyway, so the cap is doing
                nothing there and changing it would be churn.

                The same argument applies vertically. The parent was
                `items-start`, so this wrapper was only ever as tall as its
                content — a page could not fill the panel even when it wanted
                to, which is why the knowledge base list floated with its
                divider stopping halfway down an empty screen. `items-stretch`
                plus `flex flex-col` here makes the full height available;
                pages that want it opt in with `flex-1`, and pages that do not
                are unaffected because a column's children still size
                themselves.
              */}
              <div className="panel-content-wrapper flex w-full max-w-6xl flex-col 2xl:max-w-[100rem]">
                {children}
              </div>
            </div>
          </main>
        </div>
      </SidebarCollapseContext.Provider>
    </SidebarMobileContext.Provider>
  );
}
