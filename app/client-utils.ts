// Small helpers shared by the client components.

/** Today as YYYY-MM-DD in the user's timezone. */
export function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Session expired or logged out elsewhere: go back to the login page. */
export function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Nejsi přihlášen");
  }
}
