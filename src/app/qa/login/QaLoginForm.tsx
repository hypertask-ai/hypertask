"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "w-full !h-12 !rounded-full !border !border-[#4c5362] !bg-[#212429] !px-[22px] !py-0 !text-[15px] text-white placeholder:!text-[#8e9093] outline-none focus:!border-[#8e9093] focus:!ring-0";
const buttonClass =
  "w-full !h-12 !rounded-lg !px-4 !py-0 !text-[15px] !shadow-none !bg-[#333B47] !text-white hover:!bg-[#4f5766] focus:!ring-0 focus:!ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed";

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
        <label htmlFor="email" className="mb-2 block text-[15px] text-[#8e9093]">
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
          className="mb-2 block text-[15px] text-[#8e9093]"
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
        <p className="text-left text-[15px] text-red-400">{error}</p>
      ) : null}
    </form>
  );
}
