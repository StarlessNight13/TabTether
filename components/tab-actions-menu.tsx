import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { IconMoreVertical } from "../entrypoints/popup/components/icons";

export function TabActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 190),
        left: Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248)),
      });
    }
    setOpen((value) => !value);
  };

  return (
    <>
      <button
        ref={trigger}
        className="btn secondary tab-actions-menu__trigger"
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <IconMoreVertical />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              className="tab-actions-menu__items"
              role="menu"
              style={position}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
