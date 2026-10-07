import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// 見た目は v2.css の .btn と同じ決まり(docs/DESIGN-SYSTEM.md §3): 押す場所 44px 以上・角 8px・影なし・
// フォーカスの輪は全部品共通(v2.css の :focus-visible)。主=塗り、副=白地+深緑の枠、文字だけ=ghost、取り消し=白地+赤茶の枠。
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-base font-bold leading-tight transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[18px] shrink-0 [&_svg]:shrink-0 outline-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
        destructive:
          "border border-destructive bg-card text-destructive hover:bg-[var(--st-danger-bg)]",
        outline:
          "border border-primary bg-card text-primary hover:bg-accent",
        secondary:
          "border border-primary bg-card text-primary hover:bg-accent",
        ghost: "text-[var(--link)] hover:bg-accent",
        link: "text-[var(--link)] underline underline-offset-4",
      },
      size: {
        default: "min-h-11 px-4 py-2",
        sm: "min-h-11 px-3 py-2",
        lg: "min-h-14 px-6 py-2",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
