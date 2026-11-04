// In-app replacement for window.confirm: `if (await askConfirm({...}))` anywhere, one <ConfirmHost /> in App.
import { useEffect, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { Modal } from "./GameDialogs";

interface Request {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for things that lose something (resign, delete). */
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ request: Request | null }>(() => ({ request: null }));

export function askConfirm(opts: Omit<Request, "resolve">): Promise<boolean> {
  useConfirm.getState().request?.resolve(false);
  return new Promise((resolve) => useConfirm.setState({ request: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), [request]);
  if (!request) return null;
  const answer = (yes: boolean) => {
    useConfirm.setState({ request: null });
    request.resolve(yes);
  };
  return (
    <Modal title={request.title} onClose={() => answer(false)} className="confirm">
      {request.body && <div className="confirm-body">{request.body}</div>}
      <footer>
        <button onClick={() => answer(false)}>Cancel</button>
        <button ref={ok} className={request.danger ? "danger" : "primary"} onClick={() => answer(true)}>
          {request.confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
