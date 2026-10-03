import { newId } from "./id";

export const accountBoundaryKey = "bulkbro-account-boundary";

function sharedBoundary(): string | null | undefined {
  try {
    return localStorage.getItem(accountBoundaryKey);
  } catch {
    // Ordinary online use still works when browser storage is unavailable.
    return undefined;
  }
}

/** Each sign-in or account transition owns a distinct lifetime, even for the same user. */
export type AccountLifetime = Readonly<{
  userId?: string;
  changing: boolean;
  boundary: string | null | undefined;
}>;

let current: AccountLifetime = { changing: false, boundary: sharedBoundary() };

export class AccountStorageError extends Error {
  constructor() {
    super(
      "This browser could not notify other open tabs about the account change. Allow site storage and retry, or close every BulkBro tab and clear this site's data before sharing this device.",
    );
  }
}

export class StaleAccountError extends Error {
  constructor() {
    super(
      "The account changed while this operation was running. Please try again.",
    );
  }
}

export function accountLifetime() {
  return current;
}

export function isCurrentAccount(lifetime: AccountLifetime) {
  return lifetime === current && lifetime.boundary === sharedBoundary();
}

export function requireCurrentAccount(lifetime: AccountLifetime) {
  if (!isCurrentAccount(lifetime)) throw new StaleAccountError();
}

export function requireAccountWork(lifetime: AccountLifetime) {
  requireCurrentAccount(lifetime);
  if (lifetime.changing) throw new StaleAccountError();
}

export function startAccountLifetime(
  userId?: string,
  boundary = sharedBoundary(),
) {
  current = { userId, changing: false, boundary };
  return current;
}

export function beginAccountChange() {
  requireAccountWork(current);
  current = { ...current, changing: true };
  return current;
}

/** Publish only a committed account boundary; ordinary snapshot adoption stays local. */
export function commitAccountBoundary(userId?: string) {
  const boundary = JSON.stringify({ id: newId(), signedIn: !!userId });
  try {
    localStorage.setItem(accountBoundaryKey, boundary);
  } catch {
    // Do not report a successful device sign-out if peers cannot be invalidated.
    throw new AccountStorageError();
  }
  current = { userId, changing: false, boundary };
  return current;
}

export function boundaryIsSignedIn() {
  try {
    const boundary = sharedBoundary();
    return !!boundary && JSON.parse(boundary).signedIn === true;
  } catch {
    return false;
  }
}
