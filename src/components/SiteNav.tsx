import Link from "next/link";

const LINKS = [
  { href: "/", label: "カレンダー" },
  { href: "/sources", label: "フィード" },
] as const;

export type NavKey = (typeof LINKS)[number]["href"];

/** ページ上部の切り替え。今いるページは塗りつぶして示す */
export function SiteNav({ current }: { current: NavKey }) {
  return (
    <nav aria-label="ページ" className="flex gap-1 rounded-lg bg-zinc-200/60 p-1 text-sm dark:bg-zinc-800/60">
      {LINKS.map((link) => {
        const active = link.href === current;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-md bg-white px-3 py-1 font-medium shadow-sm dark:bg-zinc-900"
                : "rounded-md px-3 py-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
