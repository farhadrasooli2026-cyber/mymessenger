/** Client-side E2EE helpers. Thread keys never leave the device. */

export const ENC_V1 = "e2ee-v1" as const;

const THREAD_PREFIX = "nixo.e2ee.v1.thread.";
const IDENTITY_KEY = "nixo.e2ee.v1.identity";
const LOCAL_PREFIX = "nixo.e2ee.v1.local.";

export type CipherEnvelope = {
  enc: typeof ENC_V1;
  ciphertext: string;
  nonce: string;
};

export type IdentityBundle = {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
};

function bytesToB64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bytes =
    typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(b64, "base64")) : (() => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    })();
  return new Uint8Array(bytes);
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function generateThreadKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportRawKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToB64(new Uint8Array(raw));
}

export async function importRawKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBufferSource(b64ToBytes(b64)), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<CipherEnvelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBufferSource(nonce) }, key, asBufferSource(bytes));
  return { enc: ENC_V1, ciphertext: bytesToB64(new Uint8Array(ct)), nonce: bytesToB64(nonce) };
}

export async function decryptBytes(key: CryptoKey, envelope: CipherEnvelope): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(b64ToBytes(envelope.nonce)) },
    key,
    asBufferSource(b64ToBytes(envelope.ciphertext)),
  );
  return new Uint8Array(pt);
}

export async function encryptText(key: CryptoKey, plaintext: string): Promise<CipherEnvelope> {
  const encoded = new TextEncoder().encode(plaintext);
  return encryptBytes(key, encoded);
}

export async function decryptText(key: CryptoKey, envelope: CipherEnvelope): Promise<string> {
  const pt = await decryptBytes(key, envelope);
  return new TextDecoder().decode(pt);
}

export async function loadOrCreateThreadKey(threadId: string): Promise<CryptoKey> {
  const store = storage();
  const slot = `${THREAD_PREFIX}${threadId}`;
  const existing = store?.getItem(slot);
  if (existing) return importRawKey(existing);
  const key = await generateThreadKey();
  const exported = await exportRawKey(key);
  store?.setItem(slot, exported);
  return key;
}

export async function loadOrCreateIdentity(): Promise<IdentityBundle> {
  const store = storage();
  const raw = store?.getItem(IDENTITY_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as IdentityBundle;
    } catch {
      /* regenerate */
    }
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const bundle = { publicJwk, privateJwk };
  store?.setItem(IDENTITY_KEY, JSON.stringify(bundle));
  return bundle;
}

export type LocalChatMessage = {
  id: string;
  sender: "me" | "peer";
  text: string;
  createdAt: number;
  local: true;
};

export async function loadLocalMessages(threadId: string, key: CryptoKey): Promise<LocalChatMessage[]> {
  const store = storage();
  const raw = store?.getItem(`${LOCAL_PREFIX}${threadId}`);
  if (!raw) return [];
  try {
    const envelope = JSON.parse(raw) as CipherEnvelope;
    const json = await decryptText(key, envelope);
    return JSON.parse(json) as LocalChatMessage[];
  } catch {
    return [];
  }
}

export async function saveLocalMessages(threadId: string, key: CryptoKey, messages: LocalChatMessage[]): Promise<void> {
  const store = storage();
  if (!store) return;
  const envelope = await encryptText(key, JSON.stringify(messages));
  store.setItem(`${LOCAL_PREFIX}${threadId}`, JSON.stringify(envelope));
}

export function listStoredThreadKeys(): { threadId: string; raw: string }[] {
  const store = storage();
  if (!store) return [];
  const out: { threadId: string; raw: string }[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (!k?.startsWith(THREAD_PREFIX)) continue;
    const raw = store.getItem(k);
    if (raw) out.push({ threadId: k.slice(THREAD_PREFIX.length), raw });
  }
  return out;
}

export async function collectDeviceVault(settings?: unknown) {
  const store = storage();
  const keys = listStoredThreadKeys();
  const localChats: { threadId: string; messages: LocalChatMessage[] }[] = [];
  for (const k of keys) {
    try {
      const key = await importRawKey(k.raw);
      const messages = await loadLocalMessages(k.threadId, key);
      localChats.push({ threadId: k.threadId, messages });
    } catch {
      /* skip broken slot */
    }
  }
  let identity: IdentityBundle | null = null;
  try {
    const raw = store?.getItem(IDENTITY_KEY);
    identity = raw ? (JSON.parse(raw) as IdentityBundle) : null;
  } catch {
    identity = null;
  }
  return {
    v: 1 as const,
    exportedAt: Date.now(),
    identity,
    threadKeys: keys,
    localChats,
    settings,
  };
}

export async function applyDeviceVault(
  vault: {
    identity?: IdentityBundle | null;
    threadKeys?: { threadId: string; raw: string }[];
    localChats?: { threadId: string; messages: LocalChatMessage[] }[];
  },
  select: { chats?: boolean },
) {
  const store = storage();
  if (!store) return;
  if (vault.identity) store.setItem(IDENTITY_KEY, JSON.stringify(vault.identity));
  if (select.chats !== false) {
    for (const k of vault.threadKeys ?? []) {
      store.setItem(`${THREAD_PREFIX}${k.threadId}`, k.raw);
    }
    for (const chat of vault.localChats ?? []) {
      try {
        const key = await loadOrCreateThreadKey(chat.threadId);
        await saveLocalMessages(chat.threadId, key, chat.messages);
      } catch {
        /* skip */
      }
    }
  }
}

export function looksLikeEnvelope(value: unknown): value is CipherEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as CipherEnvelope;
  return v.enc === ENC_V1 && typeof v.ciphertext === "string" && typeof v.nonce === "string";
}
