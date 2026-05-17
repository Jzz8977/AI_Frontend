import { cn } from "@/lib/utils";

type TagColor = "green" | "amber" | "red" | "blue" | "dim";

const TONE: Record<TagColor, { fg: string; bd: string }> = {
  green: { fg: "var(--green)", bd: "var(--green-dim)" },
  amber: { fg: "var(--amber)", bd: "rgba(240,160,75,0.35)" },
  red: { fg: "var(--red)", bd: "rgba(248,113,113,0.35)" },
  blue: { fg: "var(--blue)", bd: "rgba(125,211,252,0.35)" },
  dim: { fg: "var(--text-dim)", bd: "var(--border)" },
};

interface TagProps {
  children: React.ReactNode;
  color?: TagColor;
  className?: string;
}

/** r1.md §4.4 — outline 风格小标签,可配色 */
export function Tag({ children, color = "dim", className }: TagProps) {
  const tone = TONE[color];
  return (
    <span
      className={cn(
        "inline-flex items-center border bg-transparent px-2 py-[3px] font-mono text-[10px] uppercase tracking-[1.5px]",
        className
      )}
      style={{ color: tone.fg, borderColor: tone.bd }}
    >
      {children}
    </span>
  );
}
