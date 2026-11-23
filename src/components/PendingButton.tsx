"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/** フォーム送信中は押せなくし、半透明にするボタン */
export function PendingButton({ className = "", disabled, ...props }: ComponentProps<"button">) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-50`}
    />
  );
}
