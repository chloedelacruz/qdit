"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeWalletRegistration, type RegisterState } from "./actions";

const EMPTY: RegisterState = {};

/**
 * Three fields, once, ever.
 *
 * The wallet address is not among them — it is rendered above this form by the
 * page, and the action reads it from the signed ticket rather than from
 * anything posted here.
 *
 * `mode` changes only the button. Which operation runs is decided server-side
 * from the session and the ticket; passing it here as a hidden field would let
 * the client choose, and the client does not get to choose.
 */
export function RegisterForm({ mode }: { mode: "create" | "complete" }) {
  const [state, formAction, pending] = useActionState(
    completeWalletRegistration,
    EMPTY,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          // Not `type="text"` with a pattern: the schema lowercases, so a
          // capital is corrected rather than rejected, and a browser-enforced
          // pattern would refuse it before the server got the chance.
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={state.fieldErrors?.username ? true : undefined}
          aria-describedby={
            state.fieldErrors?.username ? "username-error" : "username-hint"
          }
        />
        {state.fieldErrors?.username ? (
          <p id="username-error" className="text-xs text-destructive">
            {state.fieldErrors.username}
          </p>
        ) : (
          <p id="username-hint" className="text-xs text-muted-foreground">
            Lowercase letters, numbers and underscores.
          </p>
        )}
      </div>

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
          // A credential being created, unlike the one on /login — a password
          // manager should offer to generate here rather than autofill.
          autoComplete="new-password"
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
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

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
        {mode === "create" ? "Create account" : "Save"}
      </Button>
    </form>
  );
}
