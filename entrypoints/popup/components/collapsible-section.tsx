import { useEffect, useId, useState, type ReactNode } from "react";

function readStoredOpen(storageKey: string, defaultOpen: boolean) {
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored === null) return defaultOpen;
    return stored === "1";
  } catch {
    return defaultOpen;
  }
}

export function CollapsibleSection({
  id,
  title,
  defaultOpen = false,
  badge,
  actions,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const storageKey = `popup-section:${id}`;
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen));
  const contentId = useId();

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, open ? "1" : "0");
    } catch {
      // sessionStorage may be unavailable in some profiles.
    }
  }, [open, storageKey]);

  return (
    <section className={`section collapsible-section${open ? " collapsible-section--open" : ""}`}>
      <div className="collapsible-section__header">
        <button
          type="button"
          className="collapsible-section__toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="collapsible-section__chevron" aria-hidden />
          <span className="section-title collapsible-section__title">{title}</span>
          {!open && badge ? (
            <span
              className="collapsible-section__badge"
              title={typeof badge === "string" ? badge : undefined}
            >
              {badge}
            </span>
          ) : null}
        </button>
        {actions ? (
          <div
            className="collapsible-section__actions"
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {open ? (
        <div id={contentId} className="collapsible-section__body">
          {children}
        </div>
      ) : null}
    </section>
  );
}
