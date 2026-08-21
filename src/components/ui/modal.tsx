"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeClasses = {
  sm: "max-w-[360px]",
  md: "max-w-[480px]",
  lg: "max-w-[560px]",
  xl: "max-w-[720px]",
} as const;

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // Call-site onClose is often an inline lambda (review modal, BYOK, etc.).
  // Putting it in the focus-trap effect deps re-ran first?.focus() on every
  // parent keystroke and stole focus to the first focusable control.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // PR2.9-fix2: portal to document.body so modal-on-modal stacking is
  // deterministic and JSX-order-independent. Before this change, two
  // open Modals at the same z-50 would stack by source-code order -
  // which was fragile and produced a real bug on staging where the
  // BYOK credentials modal opened from inside the Browse modal
  // rendered BENEATH Browse (different JSX-parent locations: BYOK at
  // Step2 level, Browse-internal CredentialsModal at Browse-fragment
  // level). Portaling to body makes mount order the only signal, and
  // the latest-opened modal always wins - correct UX universally.
  //
  // Audit confirmed (PR2.9-fix2 description, table of 16 call sites)
  // that no Modal call site has a transform-creating ancestor, so
  // portaling produces visually identical results at every existing
  // site.
  //
  // SSR guard: createPortal cannot run during server render (no
  // document). `mounted` flips true in useEffect, which only runs
  // client-side. Modal renders null during SSR + first client paint;
  // first useful render happens after hydration. This matches the
  // tooltip pattern in src/components/ui/tooltip.tsx.
  const [mounted, setMounted] = useState(false);
  // This is the canonical SSR-safe portal mount pattern documented by
  // the React team: createPortal cannot run during SSR, so we render
  // null on the server + first client paint, then flip `mounted` true
  // after hydration. The mount-effect is a deliberate one-shot
  // initialization (deps=[]) and re-renders exactly once - not a
  // cascading update. Same pattern as src/components/ui/tooltip.tsx:28
  // (tooltip.tsx carries an identical pre-existing rule violation;
  // out-of-scope for this PR per minimum-scope rule).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab" || !boxRef.current) return;

    const focusable = boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement;

    const timer = setTimeout(() => {
      if (!boxRef.current) return;
      // Focus-once-while-open: if the user already moved into a field,
      // do not yank focus back to the first control.
      if (boxRef.current.contains(document.activeElement)) return;
      const first = boxRef.current.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
      trapFocus(e);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previousFocus.current?.focus();
    };
  }, [open, trapFocus]);

  if (!open) return null;
  // Skip SSR + first client paint until mounted flips true; then portal
  // to document.body. Same pattern as tooltip.tsx.
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-[rgba(0,0,0,0.3)] z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCloseRef.current(); }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "bg-[var(--bg)] border border-[var(--bd)] rounded-xl p-5 shadow-modal w-full mx-4",
          sizeClasses[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[15px] font-semibold mb-1">{title}</h2>
        {description && <p className="text-xs text-[var(--tx2)] mb-3.5">{description}</p>}
        {children}
        {footer && <div className="flex gap-1.5 justify-end mt-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
