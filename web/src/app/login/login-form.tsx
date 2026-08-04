"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp, type AuthState } from "./actions";

const EMPTY: AuthState = {};

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="text-xs text-destructive">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          // Tells a password manager whether to offer a saved credential or
          // generate a new one.
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="text-xs text-destructive">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {state.notice}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
        {mode === "signin" ? "Sign in" : "Create account"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="transition-qdit focus-ring rounded text-foreground underline underline-offset-4 hover:text-primary"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
