import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, currentUser, parseContact, setMockDelay, signIn, signOut, verifyCode } from "./mock-auth";

/** A localStorage that lives in memory, as tests run in Node. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in the mock")));
const xhrSpy = vi.fn();

beforeEach(() => {
  setMockDelay(0);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("XMLHttpRequest", xhrSpy);
  fetchSpy.mockClear();
  xhrSpy.mockClear();
});

afterEach(() => {
  // Nothing in the mock may reach the network.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("mock auth", () => {
  it("signs up with an email, keeps the session and signs out", async () => {
    expect(currentUser()).toBeNull();
    const challenge = await signIn({ contact: " Sam@Example.com ", name: "Sam Lee" });
    expect(challenge).toMatchObject({ email: "sam@example.com", name: "Sam Lee", isNew: true });

    const user = await verifyCode(challenge, "123456");
    expect(user).toMatchObject({ name: "Sam Lee", email: "sam@example.com" });
    expect(user.id).toMatch(/^mock_/);
    expect(Date.parse(user.createdAt)).not.toBeNaN();
    expect(currentUser()).toEqual(user);

    await signOut();
    expect(currentUser()).toBeNull();
  });

  it("accepts any 6-digit code and rejects anything else", async () => {
    const challenge = await signIn({ contact: "0412 345 678" });
    await expect(verifyCode(challenge, "12345")).rejects.toBeInstanceOf(AuthError);
    await expect(verifyCode(challenge, "abcdef")).rejects.toBeInstanceOf(AuthError);
    expect(currentUser()).toBeNull();
    const user = await verifyCode(challenge, "987 654");
    expect(user).toMatchObject({ phone: "+61412345678", name: "Customer" });
  });

  it("signs an unknown contact up, and a known one back into the same account", async () => {
    const first = await verifyCode(await signIn({ contact: "alex.smith@example.com" }), "000000");
    expect(first.name).toBe("Alex");
    await signOut();

    const again = await signIn({ contact: "ALEX.SMITH@example.com" });
    expect(again.isNew).toBe(false);
    const second = await verifyCode(again, "111111");
    expect(second.id).toBe(first.id);
  });

  it("rejects what isn't an email or a phone number", () => {
    expect(() => parseContact("hello")).toThrow(AuthError);
    expect(() => parseContact("a@b")).toThrow(AuthError);
    expect(parseContact("+44 7700 900123")).toEqual({ phone: "+447700900123" });
  });
});
