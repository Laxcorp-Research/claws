"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useCallback, useId } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "max-w-[360px]",
  md: "max-w-[480px]",
  lg: "max-w-[560px]",
} as const;

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

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
      const first = boxRef.current.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
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
  }, [open, onClose, trapFocus]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-[rgba(0,0,0,0.3)] z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
    </div>
  );
}
