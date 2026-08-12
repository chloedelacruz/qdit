"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type AuthState } from "./actions";

const EMPTY: AuthState = {};

/**
 * Sign in with email and password — the recovery path, not the front door.
 *
 * This used to toggle between sign-in and sign-up. It no longer does, because
 * an account is not something you fill in a form to get: connecting a wallet
 * creates one. An email and password are attached afterwards, so that losing
 * the wallet does not lose the workspace, and this form is how the person who
 * lost it gets back in.
 *
 * So there is nothing here to sign *up* with. `signUp()` still exists in
 * ./actions.ts and nothing imports it; the note above it says why.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, EMPTY);

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
          // Always an existing credential now: this form only signs in, so a
          // password manager should offer what it has rather than generate one.
          autoComplete="current-password"
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

      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
        Sign in
      </Button>
    </form>
  );
}
