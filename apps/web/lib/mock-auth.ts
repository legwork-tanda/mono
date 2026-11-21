/**
 * Customer accounts, MOCKED (#63). Nothing leaves the browser: there's no
 * request, no email or SMS and no password. The "account" is a record in
 * localStorage. The screens only use `signIn`, `verifyCode`, `currentUser` and
 * `signOut`, so a real provider can replace this file and leave them alone.
 *
 * Every mocked piece is marked `// MOCK:` so it can be found in one pass.
 */

export type Contact = { email: string; phone?: never } | { phone: string; email?: never };

/**
 * The person on this device. A guest has a generated username and no contact:
 * every device gets one on first open (`ensureUser`), so each person's jobs go
 * to the API under their own id and never get mixed up with anyone else's.
 */
export type User = { id: string; name: string; createdAt: string } & (Contact | { guest: true; email?: never; phone?: never });

export const isGuest = (user: User): boolean => "guest" in user && user.guest === true;

/** What `signIn` hands back: the code "was sent" here. Pass it to `verifyCode`. */
export type Challenge = Contact & { name?: string; isNew: boolean };

export class AuthError extends Error {}

// MOCK: the code that's shown as a hint. Any 6 digits are accepted.
export const MOCK_CODE_HINT = "123456";

const SESSION_KEY = "legwork.account";
// MOCK: stands in for the provider's user table, so signing in again with the
// same email or phone gets the same name back.
const ACCOUNTS_KEY = "legwork.mockAccounts";

// MOCK: a short pause so loading states show, as a real request would.
let delayMs = 600;

/** Tests set this to 0. */
export function setMockDelay(ms: number) {
  delayMs = ms;
}

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

/** Turns what was typed into an email or an Australian phone number, or throws. */
export function parseContact(input: string): Contact {
  const value = input.trim();
  if (value.includes("@")) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AuthError("That email doesn't look right.");
    return { email: value.toLowerCase() };
  }
  const digits = value.replace(/[\s()-]/g, "");
  if (/^(\+61|0)4\d{8}$/.test(digits)) return { phone: digits.replace(/^0/, "+61") };
  if (/^\+?\d{8,15}$/.test(digits)) return { phone: digits.startsWith("+") ? digits : `+${digits}` };
  throw new AuthError("Enter an email or a mobile number.");
}

const contactKey = (c: Contact) => (c.email !== undefined ? `email:${c.email}` : `phone:${c.phone}`);

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode etc.: signed in until the page reloads.
  }
}

const accounts = () => read<Record<string, User>>(ACCOUNTS_KEY) ?? {};

/**
 * Starts signing in or up. With `name` it's a sign-up. An unknown email or
 * phone without a name still works: the account is made with a name from it.
 */
export async function signIn(input: { contact: string; name?: string }): Promise<Challenge> {
  const contact = parseContact(input.contact);
  const name = input.name?.trim() || undefined;
  await wait();
  // MOCK: a real provider sends the code here. Nothing is sent.
  return { ...contact, name, isNew: !accounts()[contactKey(contact)] };
}

/** Checks the code and signs in. Throws `AuthError` if it isn't 6 digits. */
export async function verifyCode(challenge: Challenge, code: string): Promise<User> {
  const clean = code.replace(/\s/g, "");
  await wait();
  // MOCK: any 6 digits pass.
  if (!/^\d{6}$/.test(clean)) throw new AuthError("Enter the 6-digit code.");

  const key = contactKey(challenge);
  const all = accounts();
  const contact: Contact = challenge.email !== undefined ? { email: challenge.email } : { phone: challenge.phone };
  const existing = all[key];
  const user: User = existing
    ? { ...existing, name: challenge.name ?? existing.name }
    : // MOCK: the account is made on the spot, on this device only.
      { id: `mock_${crypto.randomUUID()}`, name: challenge.name ?? defaultName(contact), createdAt: new Date().toISOString(), ...contact };
  write(ACCOUNTS_KEY, { ...all, [key]: user });
  write(SESSION_KEY, user);
  return user;
}

/** The signed-in customer on this device, or null. */
export function currentUser(): User | null {
  // MOCK: the session is the localStorage record; a provider would check a token.
  return read<User>(SESSION_KEY);
}

export async function signOut(): Promise<void> {
  // MOCK: forgets the session. Jobs on this device stay, as they're not tied to the account.
  write(SESSION_KEY, null);
}

// Parts for generated usernames, e.g. "Swift Wombat 42".
const ADJECTIVES = ["Swift", "Calm", "Bright", "Lucky", "Sunny", "Brave", "Quiet", "Clever", "Jolly", "Keen", "Bold", "Witty", "Mellow", "Zippy", "Breezy", "Nimble"];
const ANIMALS = ["Wombat", "Quokka", "Koala", "Kookaburra", "Echidna", "Platypus", "Wallaby", "Possum", "Galah", "Dingo", "Numbat", "Bilby", "Cockatoo", "Magpie", "Emu", "Lorikeet"];

const randomInt = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;

/** A random username, e.g. "Swift Wombat 42". */
export function randomUsername() {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${ANIMALS[randomInt(ANIMALS.length)]} ${10 + randomInt(90)}`;
}

/** Makes a fresh guest with a random username and id, and makes it this device's user. */
export function newGuest(): User {
  const user: User = { id: `user_${crypto.randomUUID()}`, name: randomUsername(), createdAt: new Date().toISOString(), guest: true };
  write(SESSION_KEY, user);
  return user;
}

/** This device's user: the signed-in account, or a guest made on the spot the first time. */
export function ensureUser(): User {
  return currentUser() ?? newGuest();
}

/** The identity sent with `POST /jobs` (`CreateJobRequest.user`). */
export function jobUser(): { id: string; name: string } {
  const { id, name } = ensureUser();
  return { id, name };
}

function defaultName(contact: Contact) {
  if (contact.email !== undefined) {
    const local = contact.email.split("@")[0]!.split(/[._+-]/)[0] ?? "";
    return local ? local[0]!.toUpperCase() + local.slice(1) : "Customer";
  }
  return "Customer";
}

/** One or two letters for the avatar. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** How the contact reads on screen. A guest has none. */
export function contactLabel(c: Contact | User) {
  if ("guest" in c) return "Guest on this device";
  if (c.email !== undefined) return c.email;
  if (c.phone === undefined) return "";
  return c.phone.startsWith("+61") ? `0${c.phone.slice(3, 6)} ${c.phone.slice(6, 9)} ${c.phone.slice(9)}` : c.phone;
}
