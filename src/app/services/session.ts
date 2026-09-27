export const SESSION_EVENT = "auth-session-changed";
export function sessionChanged() {
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function clearSession() {
  for (const key of ["auth_token", "refresh_token", "auth_user"]) localStorage.removeItem(key);
  sessionChanged();
}
