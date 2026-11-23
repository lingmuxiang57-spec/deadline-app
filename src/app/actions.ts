"use server";

/**
 * 今日やるべきリストの書き込み（Server Actions）。
 * 自分一人で手元で使うアプリなので認証はしない。入力値はここで必ず検証する
 * （Server Actions は画面を通さず POST でも呼べるため）。
 */
import { refresh } from "next/cache";
import { getDb } from "@/db/client";
import * as mutations from "@/db/mutations";
import { syncAllSources } from "@/db/syncSources";
import { parseDeadlineInput } from "@/lib/deadlineInput";
import { QUICK_ADD_ERROR_MESSAGES, parseQuickAdd } from "@/lib/parseQuickAdd";

export type QuickAddState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "added"; title: string; addedAt: number };

export async function addQuickTask(_prev: QuickAddState, formData: FormData): Promise<QuickAddState> {
  const input = formData.get("text");
  if (typeof input !== "string") {
    return { status: "error", message: QUICK_ADD_ERROR_MESSAGES.empty };
  }
  const now = new Date();
  const result = parseQuickAdd(input, now);
  if (!result.ok) {
    return { status: "error", message: QUICK_ADD_ERROR_MESSAGES[result.error] };
  }
  mutations.addManualTask(getDb(), { title: result.title, deadline: result.deadline });
  refresh();
  return { status: "added", title: result.title, addedAt: now.getTime() };
}

export async function setEstimate(formData: FormData): Promise<void> {
  mutations.setEstimate(getDb(), readId(formData), readInt(formData, "minutes"));
  refresh();
}

export async function completeTask(formData: FormData): Promise<void> {
  mutations.completeTask(getDb(), readId(formData));
  refresh();
}

export async function reopenTask(formData: FormData): Promise<void> {
  mutations.reopenTask(getDb(), readId(formData));
  refresh();
}

export async function keepTask(formData: FormData): Promise<void> {
  mutations.keepTask(getDb(), readId(formData));
  refresh();
}

export async function deleteTask(formData: FormData): Promise<void> {
  mutations.deleteTask(getDb(), readId(formData));
  refresh();
}

/** 見積もりの欄などから「削除」。手入力は消し、フィード由来は「削除済み」にする */
export async function dismissTask(formData: FormData): Promise<void> {
  mutations.dismissTask(getDb(), readId(formData));
  refresh();
}

export async function restoreTask(formData: FormData): Promise<void> {
  mutations.restoreTask(getDb(), readId(formData));
  refresh();
}

/**
 * 締切を変える。date は "YYYY-MM-DD"、time は "HH:MM"（空ならその日の 23:59）。
 * 日付の入力欄（type="date"）と時刻の入力欄（type="time"）から送られる形をそのまま受け取る
 */
export async function changeDeadline(formData: FormData): Promise<void> {
  const deadline = parseDeadlineInput(formData.get("date"), formData.get("time"));
  if (deadline) {
    mutations.setDeadline(getDb(), readId(formData), deadline);
  }
  refresh();
}

export async function resetDeadline(formData: FormData): Promise<void> {
  mutations.resetDeadline(getDb(), readId(formData));
  refresh();
}

/** 「今すぐ同期」。自動同期の間隔を待たずにすべてのフィードを取りに行く */
export async function syncNow(): Promise<void> {
  await syncAllSources(getDb());
  refresh();
}

function readId(formData: FormData): number {
  return readInt(formData, "id");
}

function readInt(formData: FormData, name: string): number {
  const value = Number(formData.get(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} が不正です`);
  }
  return value;
}
