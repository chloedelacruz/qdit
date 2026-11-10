"use client";

/* eslint-disable @next/next/no-img-element -- previews are blob: and signed
   Storage URLs, which next/image would have to proxy and cache. */

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";
import {
  checkImageFile,
  IMAGE_ACCEPT,
  MINDMAP_BUCKET,
  mindmapPath,
  uploadErrorMessage,
} from "@/lib/hackathon/schemas";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** What a slot holds: the Storage path the form posts, and something to show. */
export type SlotValue = { path: string; previewUrl: string | null };

/**
 * One mindmap image slot (WP-4.7, QDIT-47).
 *
 * Uploads straight from the browser to the `hackathon-mindmaps` bucket with
 * the person's own session: a Server Action body is capped at 1 MB, and the
 * bucket's INSERT policy is the check that matters (first-party session,
 * project owner or admin, window open). Type and size are checked here first,
 * so a wrong file fails with a sentence instead of a Storage error.
 *
 * Objects are never overwritten: every pick is a new `<uuid>.<ext>`, so an
 * image a submitted version points at can never change under it.
 */
export function ImageUpload({
  name,
  label,
  required,
  hackathonId,
  projectId,
  value,
  onChange,
  onBusyChange,
  disabled,
}: {
  /** The form field the path is posted under. */
  name: string;
  label: string;
  required?: boolean;
  hackathonId: string;
  projectId: string;
  value: SlotValue | null;
  onChange: (value: SlotValue | null) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A blob: preview holds the file in memory until it is revoked.
  const blobUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    },
    [],
  );

  // A slot removed mid-upload (the project changed) must not leave the form
  // thinking an upload is still running.
  const reportBusy = useRef(onBusyChange);
  useEffect(() => {
    reportBusy.current = onBusyChange;
  }, [onBusyChange]);
  // False once this slot is gone (the project changed, the dialog closed): a
  // late upload then reports nothing, so it cannot touch the slot that
  // replaced this one under the same name.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reportBusy.current(false);
    };
  }, []);

  const setBusyBoth = (next: boolean) => {
    setBusy(next);
    onBusyChange(next);
  };

  async function upload(file: File) {
    setError(null);
    const check = checkImageFile(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    const path = mindmapPath(hackathonId, projectId, crypto.randomUUID(), check.ext);
    setBusyBoth(true);
    try {
      const { error: uploadError } = await createClient()
        .storage.from(MINDMAP_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });

      if (!mounted.current) return;
      if (uploadError) {
        setError(uploadErrorMessage(uploadError.message));
        return;
      }

      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = URL.createObjectURL(file);
      onChange({ path, previewUrl: blobUrl.current });
    } catch {
      if (mounted.current) setError("The upload did not finish. Check your connection and try again.");
    } finally {
      if (mounted.current) setBusyBoth(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <input type="hidden" name={name} value={value?.path ?? ""} />

      {/* Fixed height: a Remove button must not push this tile below its neighbours. */}
      <div className="flex h-6 items-center justify-between gap-2 pointer-coarse:h-9">
        <span id={`${inputId}-label`} className="min-w-0 truncate text-xs font-medium">
          {label}
          {required ? null : (
            <span className="ml-1.5 font-normal text-muted-foreground">Optional</span>
          )}
        </span>
        {value && !busy ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="pointer-coarse:h-9"
            onClick={() => {
              onChange(null);
              setError(null);
            }}
            aria-label={`Remove ${label.toLowerCase()} image`}
            disabled={disabled}
          >
            Remove
          </Button>
        ) : null}
      </div>

      {/* The whole tile is the picker's label, so a tap anywhere opens it. */}
      <label
        htmlFor={inputId}
        className={cn(
          "well focus-within:ring-ring/50 relative flex aspect-[16/9] cursor-pointer sm:aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-border text-center focus-within:ring-3",
          (busy || disabled) && "cursor-not-allowed opacity-70",
        )}
      >
        {value?.previewUrl ? (
          <img
            src={value.previewUrl}
            alt={`${label} preview`}
            className="size-full object-contain"
          />
        ) : value ? (
          <span className="px-2 text-xs text-muted-foreground">Attached</span>
        ) : (
          <span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground">
            {busy ? (
              <ICON.spinner className="size-4 animate-spin" aria-hidden />
            ) : (
              <ICON.add className="size-4" aria-hidden />
            )}
            {busy ? "Uploading…" : "Choose image"}
          </span>
        )}
        {busy && value ? (
          <span className="absolute inset-0 grid place-items-center bg-background/70 text-xs">
            Uploading…
          </span>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          aria-labelledby={`${inputId}-label`}
          aria-describedby={statusId}
          aria-required={required}
          aria-invalid={error ? true : undefined}
          disabled={busy || disabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>

      {/* The tile already shows the state; only an error needs a visible line. */}
      <p id={statusId} aria-live="polite" className={error ? "text-xs text-destructive" : "sr-only"}>
        {error ?? (busy ? "Uploading…" : value ? "Attached." : "Not attached.")}
      </p>
    </div>
  );
}
