'use client';

import { cn } from '@/lib/utils';

/**
 * The dimmed ground behind a panel that sits over the app.
 *
 * A scrim is the one thing in the panel that genuinely cannot be a semantic
 * token: it dims whatever is behind it, so `bg-foreground/40` would turn it
 * white in dark mode. `tests/architecture/panel-colours-are-tokens-not-literals.test.ts`
 * allows the literal for exactly that reason — and says in the same breath that
 * `bg-black/NN` declared separately in several places "is an overlay component
 * waiting to be written".
 *
 * This is that component, written at the point a seventh copy would otherwise
 * have been added. The slide-over and the chat's cited-source preview both use
 * it; the modal and lightbox scrims still declare their own and are worth
 * moving here too, which is a separate change because each has its own tests.
 *
 * `opacity` rather than a free `className` for the tint: the point of one
 * component is that the values are a short list rather than whatever each
 * caller typed.
 */
export function Scrim({
  onClick,
  opacity = 40,
  className,
  ...props
}: {
  onClick?: () => void;
  /** How much of the ground it hides. 30 for a sidebar, 40 for a panel. */
  opacity?: 30 | 40 | 50;
  className?: string;
} & Omit<React.ComponentProps<'div'>, 'onClick' | 'className'>) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'absolute inset-0',
        opacity === 30 && 'bg-black/30',
        opacity === 40 && 'bg-black/40',
        opacity === 50 && 'bg-black/50',
        className,
      )}
      {...props}
    />
  );
}
