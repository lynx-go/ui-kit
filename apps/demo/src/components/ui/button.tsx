import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        default: "bg-accent text-bg hover:opacity-90",
        outline: "border border-line bg-transparent hover:bg-panel-2",
        ghost: "hover:bg-panel-2",
        danger: "bg-err text-fg hover:opacity-90",
      },
      size: {
        sm: "h-7 px-2.5",
        default: "h-8 px-3",
        icon: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
