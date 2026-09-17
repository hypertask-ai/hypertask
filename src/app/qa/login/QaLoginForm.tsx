"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "h-12 w-full rounded-sm border-0 bg-cardBackground px-4 text-content text-white-black outline-none placeholder:text-text-light-gray focus:ring-0";
const buttonClass =
  "h-12 w-full rounded-sm bg-shadcn-primary px-4 text-content text-primary-foreground shadow-none hover:opacity-90 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50";

export function QaLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/qa-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.status === 404) {
        setError("This sign-in is not available.");
        return;
      }
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        redirectUrl?: string;
      } | null;
      if (!response.ok || !data?.success) {
        setError(data?.error || "Invalid email or password");
        return;
      }
      router.replace(data.redirectUrl || "/");
    } catch {
      setError("Sign-in failed. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-content text-text-light-gray"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
          placeholder="Enter your email address..."
          required
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-2 block text-content text-text-light-gray"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
          placeholder="Password"
          required
        />
      </div>
      <button type="submit" disabled={isLoading} className={buttonClass}>
        {isLoading ? "Signing in..." : "Sign in"}
      </button>
      {error ? (
        <p className="text-left text-content text-destructive">{error}</p>
      ) : null}
    </form>
  );
}
