import { cn } from "@/lib/utils";

type DotColor = "green" | "amber" | "red" | "blue" | "dim";

const COLORS: Record<DotColor, string> = {
  green: "#3FB950",
  amber: "#F0A04B",
  red: "#F87171",
  blue: "#7DD3FC",
  dim: "#5A5A5A",
};

interface DotProps {
  color?: DotColor;
  pulse?: boolean;
  size?: number;
  className?: string;
}

/** r1.md §4.4 — 小圆点,带 box-shadow 光晕,可选 pulse 动画 */
export function Dot({
  color = "green",
  pulse = false,
  size = 8,
  className,
}: DotProps) {
  const c = COLORS[color];
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full",
        pulse && "anim-pulse",
        className
      )}
      style={{
        width: size,
        height: size,
        background: c,
        boxShadow: `0 0 8px ${c}99`,
      }}
      aria-hidden
    />
  );
}
