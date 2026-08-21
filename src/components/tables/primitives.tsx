import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-border bg-card">
      <table className="w-full table-dense">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top", className)}>{children}</td>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-t border-border hover:bg-muted/40">{children}</tr>;
}
