import type SignClient from "@walletconnect/sign-client";
import { ACTIVE_NETWORK } from "@/lib/network";
import type { WalletAdapter } from "./types";

export type WalletConnectStatus =
  "idle" | "pending" | "connected" | "rejected" | "timed-out" | "disconnected";

export interface WalletConnectViewState {
  status: WalletConnectStatus;
  uri: string | null;
  message: string | null;
}

const INITIAL_STATE: WalletConnectViewState = { status: "idle", uri: null, message: null };
const SESSION_TIMEOUT_MS = 2 * 60_000;
const listeners = new Set<() => void>();
const disconnectListeners = new Set<() => void>();
let viewState = INITIAL_STATE;
let clientPromise: Promise<SignClient> | null = null;
let activeTopic: string | null = null;

function publish(next: WalletConnectViewState): void {
  viewState = next;
  listeners.forEach((listener) => listener());
}

export function getWalletConnectState(): WalletConnectViewState {
  return viewState;
}

export function subscribeWalletConnect(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function getClient(): Promise<SignClient> {
  if (clientPromise) return clientPromise;
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId)
    throw new Error("WalletConnect is not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.");
  clientPromise = import("@walletconnect/sign-client").then(async ({ default: Client }) => {
    const client = await Client.init({
      projectId,
      metadata: {
        name: "Refract",
        description: "Parametric insurance on Stellar",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.svg`],
      },
    });
    client.on("session_delete", ({ topic }) => {
      if (topic !== activeTopic) return;
      activeTopic = null;
      publish({
        status: "disconnected",
        uri: null,
        message: "The mobile wallet disconnected the session.",
      });
      disconnectListeners.forEach((listener) => listener());
    });
    client.on("session_expire", ({ topic }) => {
      if (topic !== activeTopic) return;
      activeTopic = null;
      publish({ status: "disconnected", uri: null, message: "The WalletConnect session expired." });
      disconnectListeners.forEach((listener) => listener());
    });
    return client;
  });
  return clientPromise;
}

function accountFromSession(session: {
  namespaces: Record<string, { accounts: string[] }>;
}): string | null {
  const account = session.namespaces?.stellar?.accounts?.[0];
  return typeof account === "string" ? (account.split(":")[2] ?? null) : null;
}

async function clearPairings(client: SignClient): Promise<void> {
  await Promise.allSettled(
    client.core.pairing
      .getPairings()
      .map((pairing) => client.core.pairing.disconnect({ topic: pairing.topic }))
  );
}

export async function cancelWalletConnect(): Promise<void> {
  if (!clientPromise) {
    publish(INITIAL_STATE);
    return;
  }
  const client = await clientPromise;
  await clearPairings(client);
  publish(INITIAL_STATE);
}

export const walletConnectAdapter: WalletAdapter = {
  id: "walletconnect",
  name: "WalletConnect",
  installUrl: "https://walletconnect.network/wallets",
  isAvailable: () => typeof window !== "undefined",
  async connect() {
    const client = await getClient();
    const chain = ACTIVE_NETWORK.id === "mainnet" ? "stellar:pubnet" : "stellar:testnet";
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        stellar: { chains: [chain], methods: ["stellar_signXDR"], events: [] },
      },
    });
    if (!uri) throw new Error("WalletConnect did not return a pairing URI.");
    publish({ status: "pending", uri, message: null });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const session = await Promise.race([
        approval(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("WALLETCONNECT_TIMEOUT")), SESSION_TIMEOUT_MS);
        }),
      ]);
      activeTopic = session.topic;
      const address = accountFromSession(session);
      if (!address) throw new Error("The wallet returned no Stellar account.");
      publish({ status: "connected", uri: null, message: null });
      return address;
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "WALLETCONNECT_TIMEOUT";
      publish({
        status: timedOut ? "timed-out" : "rejected",
        uri: null,
        message: timedOut
          ? "The connection request timed out. Try again."
          : "The mobile wallet rejected the connection.",
      });
      await clearPairings(client);
      throw new Error(
        timedOut ? "WalletConnect request timed out" : "WalletConnect request was rejected"
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
  async getAddress() {
    try {
      const client = await getClient();
      const session = activeTopic ? client.session.get(activeTopic) : client.session.getAll()[0];
      if (!session) return null;
      activeTopic = session.topic;
      return accountFromSession(session);
    } catch {
      return null;
    }
  },
  async getNetwork() {
    return {
      network: ACTIVE_NETWORK.id.toUpperCase(),
      networkPassphrase: ACTIVE_NETWORK.networkPassphrase,
    };
  },
  async signTransaction(txXdr, { networkPassphrase }) {
    const client = await getClient();
    if (!activeTopic) throw new Error("WalletConnect session is not active");
    const chainId =
      networkPassphrase === "Public Global Stellar Network ; September 2015"
        ? "stellar:pubnet"
        : "stellar:testnet";
    const result = await client.request<{ signedXDR: string }>({
      topic: activeTopic,
      chainId,
      request: { method: "stellar_signXDR", params: { xdr: txXdr } },
    });
    if (!result.signedXDR) throw new Error("Transaction signing was declined");
    return result.signedXDR;
  },
  async disconnect() {
    if (!clientPromise) return;
    const client = await clientPromise;
    if (activeTopic) {
      await client.disconnect({
        topic: activeTopic,
        reason: { code: 6000, message: "User disconnected" },
      });
      activeTopic = null;
    }
    await clearPairings(client);
    publish({ status: "disconnected", uri: null, message: null });
  },
  subscribeDisconnect(listener) {
    disconnectListeners.add(listener);
    return () => disconnectListeners.delete(listener);
  },
};

export function resetWalletConnectForTests(): void {
  clientPromise = null;
  activeTopic = null;
  publish(INITIAL_STATE);
  disconnectListeners.clear();
}
