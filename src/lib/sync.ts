/**
 * iCalフィード（K-LMS、Googleカレンダー）の取得・解析・照合。
 *
 *   fetchIcs  … URLからiCalの本文を取る（webcal:// も受け付ける）
 *   parseIcs  … 本文を締切の一覧にする（繰り返し予定は直近の1回だけ）
 *   planSync  … DBにある締切とUIDで照合し、追加・更新の計画を返す（DBには触らない）
 *
 * 繰り返し予定（毎週の「GM資料」など）:
 *   - これから来る最初の1回だけを締切にする。その回が過ぎたら、次の同期で次の回が出てくる
 *   - 回ごとに「UID#その回の本来の開始日時（ISO）」で区別する（時間を変えた回も同じIDのまま）
 *   - どれか1回を自分で「削除」したら、その繰り返し予定の以後の回も取り込まない（毎週のバイトなどを一度で消せる）
 *
 * 照合の規則（README「データ設計」）:
 *   - 一致したものは件名と締切だけ更新する。所要時間・完了状態・「残す」は上書きしない
 *   - フィードから消えたものは削除せず「取り消し確認」にする。ただし未着手で締切が未来のものに限る
 *     （過去の締切はフィードから自然に消えることがあるため）
 *   - 「取り消し確認」で自分が「残す」を選んだものは、以後フィードになくても確認に戻さない
 *   - 自分で「削除」したもの（dismissed）は、件名・締切の変更だけ反映し、状態は変えない（リストに戻さない）
 *   - 「取り消し確認」のものがフィードに戻ってきたら未着手に戻す
 *   - 新しいものは締切が未来のものだけ追加する（過去の課題で「今日やる」が埋まらないように）
 *
 * iCal URL自体が認証トークンなので、エラーメッセージやログにURLを含めない。
 */
import ICAL from "ical.js";
import { TIME_ZONE, isValidTimeZone, jstDateTime, formatDateKey, zonedTimeToDate } from "./date";

/**
 * todo: 未着手 / done: 完了 / cancel_pending: 取り消し確認
 * dismissed: 自分で「削除」したフィード由来の締切。DBに残してUIDで見分け、同期で再び取り込まないようにする
 */
export type TaskStatus = "todo" | "done" | "cancel_pending" | "dismissed";

/** フィードから読み取った締切 */
export interface FeedEvent {
  /** iCalのUID。繰り返し予定の回は「UID#その回の本来の開始日時」 */
  externalUid: string;
  title: string;
  deadline: Date;
}

const OCCURRENCE_SEPARATOR = "#";
/** 「UID#2026-11-30T01:00:00.000Z」の形。UIDそのものに「#」が含まれていても取り違えないよう、日時の形まで見る */
const OCCURRENCE_PATTERN = /^(.+)#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** 繰り返し予定の回のIDから、繰り返し予定そのもののUIDを取り出す。単発の予定なら null */
export function seriesUidOf(externalUid: string): string | null {
  return OCCURRENCE_PATTERN.exec(externalUid)?.[1] ?? null;
}

/** DBにある、そのフィード由来の締切 */
export interface SyncedTask {
  id: number;
  externalUid: string;
  title: string;
  deadline: Date;
  status: TaskStatus;
  /** 「取り消された？」で「残す」を選んだか。true ならフィードから消えていても確認に戻さない */
  kept: boolean;
}

export interface TaskUpdate {
  id: number;
  changes: Partial<{ title: string; deadline: Date; status: TaskStatus }>;
}

export interface SyncPlan {
  inserts: FeedEvent[];
  updates: TaskUpdate[];
}

export type SyncErrorKind = "invalidUrl" | "network" | "http" | "notCalendar" | "parse";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SyncError";
  }
}

const UNTITLED = "（無題）";

// ---------------------------------------------------------------------------
// 取得

export interface FetchIcsOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** webcal:// を https:// に直し、http(s) 以外は弾く */
export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim().replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SyncError("invalidUrl", "URLの形式が正しくありません");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SyncError("invalidUrl", "http(s) または webcal のURLを指定してください");
  }
  return url.toString();
}

export async function fetchIcs(feedUrl: string, options: FetchIcsOptions = {}): Promise<string> {
  const { fetch: fetchImpl = fetch, timeoutMs = 10_000 } = options;
  const url = normalizeFeedUrl(feedUrl);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "text/calendar" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new SyncError("network", "フィードに接続できませんでした", { cause });
  }
  if (!response.ok) {
    throw new SyncError("http", `フィードの取得に失敗しました（HTTP ${response.status}）`);
  }
  const text = await response.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new SyncError("notCalendar", "iCal形式のデータではありません（URLを確認してください）");
  }
  return text;
}

// ---------------------------------------------------------------------------
// 解析

/** 壊れたRRULEで無限に回らないための上限 */
const MAX_OCCURRENCES_TO_SCAN = 10_000;

/**
 * iCalの本文を締切の一覧にする。
 * 単発の予定はすべて返す（過去のものも。追加するかは planSync が決める）。
 * 繰り返し予定（RRULE・RDATE）は、now より後に来る最初の1回だけを返す。
 * 個別の変更（RECURRENCE-ID）や回ごとの取り消し、除外日（EXDATE）は ical.js が反映する。
 */
export function parseIcs(text: string, now: Date): FeedEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (cause) {
    throw new SyncError("parse", "iCalの内容を読み取れませんでした", { cause });
  }

  const vevents = root.getAllSubcomponents("vevent");
  const masterUids = new Set(vevents.filter((v) => !v.hasProperty("recurrence-id")).map(uidOf));
  const events: FeedEvent[] = [];

  for (const vevent of vevents) {
    const uid = uidOf(vevent);
    if (!uid || isCancelled(vevent)) continue;

    const event = new ICAL.Event(vevent);

    if (event.isRecurrenceException()) {
      // 個別変更は親の繰り返し予定の中で扱う。親が届いていないときだけ、その1回を単独で扱う
      if (!masterUids.has(uid)) {
        const deadline = timeToDate(event.startDate);
        if (deadline > now) {
          events.push({ externalUid: occurrenceUid(uid, event.recurrenceId), title: titleOf(event), deadline });
        }
      }
      continue;
    }

    if (!event.isRecurring()) {
      events.push({ externalUid: uid, title: titleOf(event), deadline: timeToDate(event.startDate) });
      continue;
    }

    const next = nextOccurrence(event, now);
    if (next) {
      events.push({ externalUid: occurrenceUid(uid, next.recurrenceId), title: titleOf(next.item), deadline: next.deadline });
    }
  }
  return events;
}

/** 繰り返し予定のうち、now より後に始まる最初の回（取り消された回は飛ばす） */
function nextOccurrence(
  event: ICAL.Event,
  now: Date,
): { recurrenceId: ICAL.Time; item: ICAL.Event; deadline: Date } | null {
  // RFC 5545 では DTSTART も最初の回に数えるが、ical.js は RDATE だけの予定でこれを飛ばすので、先に確かめる
  const first = event.startDate;
  if (!isExcluded(event.component, first)) {
    const details = event.getOccurrenceDetails(first);
    const deadline = timeToDate(details.startDate);
    if (!isCancelled(details.item.component) && deadline > now) {
      return { recurrenceId: details.recurrenceId, item: details.item, deadline };
    }
  }

  const iterator = event.iterator();
  for (let i = 0; i < MAX_OCCURRENCES_TO_SCAN; i++) {
    const time = iterator.next();
    if (!time) return null;
    const details = event.getOccurrenceDetails(time);
    if (isCancelled(details.item.component)) continue;
    const deadline = timeToDate(details.startDate);
    if (deadline > now) {
      return { recurrenceId: details.recurrenceId, item: details.item, deadline };
    }
  }
  return null;
}

/** その日時が除外日（EXDATE）に入っているか */
function isExcluded(vevent: ICAL.Component, time: ICAL.Time): boolean {
  const target = timeToDate(time).getTime();
  return vevent
    .getAllProperties("exdate")
    .flatMap((property) => property.getValues())
    .some((value) => value instanceof ICAL.Time && timeToDate(value).getTime() === target);
}

function occurrenceUid(uid: string, recurrenceId: ICAL.Time): string {
  return `${uid}${OCCURRENCE_SEPARATOR}${timeToDate(recurrenceId).toISOString()}`;
}

function uidOf(vevent: ICAL.Component): string {
  const value = vevent.getFirstPropertyValue("uid");
  return typeof value === "string" ? value.trim() : "";
}

function isCancelled(vevent: ICAL.Component): boolean {
  const status = vevent.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function titleOf(event: ICAL.Event): string {
  return event.summary?.trim() || UNTITLED;
}

/**
 * ical.js の時刻を Date にする。
 *   - 終日の予定 → その日の 23:59（日本時間）。手入力の「12/5」と同じ扱い
 *   - UTC、または同じファイルに VTIMEZONE がある TZID → ical.js の変換をそのまま使う
 *   - VTIMEZONE のない TZID・タイムゾーンなし（浮動時刻）→ ical.js は UTC とみなしてしまうので、
 *     TZID が IANA 名ならそのタイムゾーン、それ以外は日本時間として読み直す
 */
export function timeToDate(time: ICAL.Time): Date {
  if (time.isDate) {
    return jstDateTime(formatDateKey(time.year, time.month, time.day));
  }
  if (time.zone && time.zone.tzid !== "floating") {
    return new Date(time.toUnixTime() * 1000);
  }
  // VTIMEZONE が見つからなかった TZID は time.timezone に文字列で残る（ical.js の型定義には載っていない）
  const raw = (time as ICAL.Time & { timezone?: unknown }).timezone;
  const tzid = typeof raw === "string" ? raw : undefined;
  const timeZone = tzid && isValidTimeZone(tzid) ? tzid : TIME_ZONE;
  return zonedTimeToDate(
    {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
    },
    timeZone,
  );
}

// ---------------------------------------------------------------------------
// 照合

export function planSync(
  existing: readonly SyncedTask[],
  events: readonly FeedEvent[],
  now: Date,
): SyncPlan {
  // 同じUIDが重複して届いたら先のものを使う
  const eventsByUid = new Map<string, FeedEvent>();
  for (const event of events) {
    if (!eventsByUid.has(event.externalUid)) eventsByUid.set(event.externalUid, event);
  }

  const updates: TaskUpdate[] = [];
  const known = new Set<string>();
  // どれか1回を自分で削除した繰り返し予定は、以後の回も取り込まない
  const dismissedSeries = new Set(
    existing
      .filter((task) => task.status === "dismissed")
      .map((task) => seriesUidOf(task.externalUid))
      .filter((uid): uid is string => uid !== null),
  );

  for (const task of existing) {
    known.add(task.externalUid);
    const event = eventsByUid.get(task.externalUid);
    const changes: TaskUpdate["changes"] = {};

    if (event) {
      if (event.title !== task.title) changes.title = event.title;
      if (event.deadline.getTime() !== task.deadline.getTime()) changes.deadline = event.deadline;
      if (task.status === "cancel_pending") changes.status = "todo";
    } else if (task.status === "todo" && !task.kept && task.deadline > now) {
      changes.status = "cancel_pending";
    }

    if (Object.keys(changes).length > 0) updates.push({ id: task.id, changes });
  }

  const inserts = [...eventsByUid.values()].filter((event) => {
    if (known.has(event.externalUid) || event.deadline <= now) return false;
    const series = seriesUidOf(event.externalUid);
    return series === null || !dismissedSeries.has(series);
  });

  return { inserts, updates };
}

/** 取得 → 解析 → 照合をまとめて行う。DBへの適用は呼び出し側で行う */
export async function syncFeed(params: {
  url: string;
  existing: readonly SyncedTask[];
  now: Date;
  fetchOptions?: FetchIcsOptions;
}): Promise<SyncPlan> {
  const text = await fetchIcs(params.url, params.fetchOptions);
  const events = parseIcs(text, params.now);
  return planSync(params.existing, events, params.now);
}
