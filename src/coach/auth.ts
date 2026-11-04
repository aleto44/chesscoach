// Claude sign-in state, backed by `claude auth` (src-tauri/src/auth.rs).
import { invoke, listen } from "../backend";
import { create } from "zustand";
import { hasBackend } from "../db";
import { refreshUsage } from "./usage";

export interface AuthState {
  status: "checking" | "signed-out" | "signing-in" | "signed-in";
  email: string | null;
  /** e.g. "Pro", from the CLI's subscriptionType. */
  plan: string | null;
  /** Sign-in page, in case the browser didn't open. */
  url: string | null;
  error: string | null;
  codeSent: boolean;
  /** What the CLI has printed during this sign-in. */
  output: string;
}

export const useAuth = create<AuthState>(() => ({
  status: "checking",
  email: null,
  plan: null,
  url: null,
  error: null,
  codeSent: false,
  output: "",
}));

let output = "";

export function initAuth() {
  if (!hasBackend()) return;
  listen<string>("auth-output", (e) => {
    output += e.payload;
    const url = output.match(/https:\/\/\S+/)?.[0] ?? null;
    useAuth.setState({ output, ...(url ? { url } : {}) });
    // The CLI keeps waiting after a bad code, so let the student paste again.
    if (/invalid code/i.test(e.payload)) {
      useAuth.setState({ codeSent: false, error: "The CLI rejected that code. Copy the whole code from the browser page and try again." });
    }
  });
  listen<number | null>("auth-exit", async (e) => {
    await checkAuth();
    if (useAuth.getState().status !== "signed-in") {
      const tail = output.trim().split("\n").slice(-3).join("\n");
      useAuth.setState({ error: `Sign-in didn't complete (exit ${e.payload ?? "?"}).${tail ? `\n${tail}` : ""}` });
    }
  });
  checkAuth();
}

export async function checkAuth() {
  try {
    const s = await invoke<Record<string, any>>("auth_status");
    if (s.loggedIn) refreshUsage();
    useAuth.setState({
      status: s.loggedIn ? "signed-in" : "signed-out",
      email: s.email ?? s.account?.email ?? null,
      plan: s.subscriptionType ? s.subscriptionType[0].toUpperCase() + s.subscriptionType.slice(1) : null,
      url: null,
      codeSent: false,
    });
  } catch (e) {
    useAuth.setState({ status: "signed-out", error: String(e) });
  }
}

export async function startLogin() {
  output = "";
  useAuth.setState({ status: "signing-in", url: null, error: null, codeSent: false, output: "" });
  try {
    await invoke("auth_login");
  } catch (e) {
    useAuth.setState({ status: "signed-out", error: String(e) });
  }
}

export async function submitCode(code: string) {
  try {
    await invoke("auth_submit_code", { code });
    useAuth.setState({ codeSent: true, error: null });
  } catch (e) {
    useAuth.setState({ error: String(e) });
  }
}

export async function cancelLogin() {
  await invoke("auth_cancel");
  useAuth.setState({ status: "signed-out", url: null, codeSent: false });
}

export async function logout() {
  await invoke("coach_reset");
  try {
    await invoke("auth_logout");
  } catch (e) {
    useAuth.setState({ error: String(e) });
  }
  await checkAuth();
}
