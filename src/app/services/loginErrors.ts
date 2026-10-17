export class LoginError extends Error {
  constructor(message: string, readonly kind: "credentials" | "connection" | "server") {
    super(message);
    this.name = "LoginError";
  }
}
