/**
 * iCalフィードの登録・削除。
 * 登録時にその場で一度同期し、取り込めなかったURLは登録しない（打ち間違いにすぐ気づけるように）。
 */
import { eq } from "drizzle-orm";
import { type FetchIcsOptions, SyncError, normalizeFeedUrl } from "@/lib/sync";
import type { Db } from "./client";
import { sources } from "./schema";
import { syncSource } from "./syncSources";

export const SOURCE_NAME_MAX_LENGTH = 40;

export type RegisterSourceResult =
  | { ok: true; sourceId: number; inserted: number }
  | { ok: false; error: string };

export async function registerSource(
  db: Db,
  input: { name: string; url: string },
  now: Date = new Date(),
  fetchOptions?: FetchIcsOptions,
): Promise<RegisterSourceResult> {
  const name = input.name.normalize("NFKC").trim();
  if (name === "") {
    return { ok: false, error: "名前を入力してください（例: K-LMS）" };
  }
  if (name.length > SOURCE_NAME_MAX_LENGTH) {
    return { ok: false, error: `名前は${SOURCE_NAME_MAX_LENGTH}文字以内にしてください` };
  }

  let url: string;
  try {
    url = normalizeFeedUrl(input.url);
  } catch (error) {
    if (error instanceof SyncError) return { ok: false, error: error.message };
    throw error;
  }

  const duplicate = db.select({ name: sources.name }).from(sources).where(eq(sources.url, url)).get();
  if (duplicate) {
    return { ok: false, error: `このURLは「${duplicate.name}」として登録済みです` };
  }

  const { id } = db.insert(sources).values({ name, url }).returning({ id: sources.id }).get();
  const result = await syncSource(db, id, now, fetchOptions);
  if (!result.ok) {
    db.delete(sources).where(eq(sources.id, id)).run();
    const hint = feedUrlHint(url);
    return { ok: false, error: `${result.error}。登録はしていません${hint ? `。${hint}` : ""}` };
  }
  return { ok: true, sourceId: id, inserted: result.inserted };
}

/**
 * 取り込みに失敗したとき、URLの形から考えられる原因を返す。
 * Google カレンダーの設定画面では「公開URL」と「非公開アドレス」が並んでいて取り違えやすい。
 * どちらも、カレンダーを一般公開していない公開URLや、途中までしかコピーできていないURLは HTTP 404 になる。
 */
export function feedUrlHint(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "calendar.google.com") return null;

  if (/\/public\/basic\.ics$/.test(parsed.pathname)) {
    return "Googleカレンダーの「公開URL」は、カレンダーを一般公開していないと使えません。設定の「カレンダーの統合」にある「iCal 形式の非公開アドレス」を使ってください";
  }
  if (!parsed.pathname.endsWith(".ics")) {
    return "URLが途中までしかコピーされていないかもしれません。Googleカレンダーの非公開アドレスは「…/basic.ics」で終わります";
  }
  return null;
}

/** フィードを削除する。そのフィード由来の締切も一緒に消える（外部キーの ON DELETE CASCADE） */
export function deleteSource(db: Db, id: number): boolean {
  return db.delete(sources).where(eq(sources.id, id)).run().changes > 0;
}
