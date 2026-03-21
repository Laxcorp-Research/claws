import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  padding?: "default" | "compact";
}

export function Card({ children, className, hover, onClick, padding = "default" }: CardProps) {
  return (
    <div
      className={cn(
        "bg-[var(--bg)] border border-[var(--bd)] rounded-xl",
        padding === "default" ? "p-3.5" : "p-2.5",
        hover && "hover:border-[var(--bd2)] transition-colors duration-150 cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
