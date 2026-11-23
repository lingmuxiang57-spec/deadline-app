"use server";

/**
 * iCalフィードの登録・削除（Server Actions）。
 * 入力値はここで必ず検証する（Server Actions は画面を通さず POST でも呼べるため）。
 */
import { refresh } from "next/cache";
import { getDb } from "@/db/client";
import { deleteSource, registerSource } from "@/db/sources";

export type AddSourceState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "added"; name: string; inserted: number; addedAt: number };

export async function addSourceAction(_prev: AddSourceState, formData: FormData): Promise<AddSourceState> {
  const name = formData.get("name");
  const url = formData.get("url");
  if (typeof name !== "string" || typeof url !== "string") {
    return { status: "error", message: "名前とURLを入力してください" };
  }
  const now = new Date();
  const result = await registerSource(getDb(), { name, url }, now);
  if (!result.ok) {
    return { status: "error", message: result.error };
  }
  refresh();
  return { status: "added", name: name.trim(), inserted: result.inserted, addedAt: now.getTime() };
}

export async function deleteSourceAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("id が不正です");
  }
  deleteSource(getDb(), id);
  refresh();
}
