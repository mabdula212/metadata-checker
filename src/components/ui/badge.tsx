import React from "react";
import { cn } from "../../lib/utils";
import { DocumentStatus } from "../../types";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "success" | "warning" | "danger" | "outline";
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = "default", children, ...props }) => {
  const variants = {
    default: "bg-neutral-900 text-white",
    secondary: "bg-neutral-100 text-neutral-800",
    success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border border-amber-200",
    danger: "bg-rose-50 text-rose-700 border border-rose-200",
    outline: "border border-neutral-300 text-neutral-700",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium tracking-wide whitespace-nowrap",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

export const StatusBadge: React.FC<{ status: DocumentStatus }> = ({ status }) => {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="success">Completed</Badge>;
    case "PROCESSING":
      return <Badge variant="warning">Processing</Badge>;
    case "UPLOADED":
      return <Badge variant="secondary">Uploaded</Badge>;
    case "FAILED":
      return <Badge variant="danger">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};
