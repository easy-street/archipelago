import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-zinc-900 text-zinc-50 hover:bg-zinc-700",
        outline: "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100",
        ghost: "text-zinc-900 hover:bg-zinc-100",
      },
      // Mobile-first sizing: unprefixed heights are touch-comfortable (≥44px
      // default); sm:+ compacts for pointer devices
      size: {
        default: "h-11 px-4 py-2 sm:h-9",
        sm: "h-9 px-3 text-xs sm:h-8",
        lg: "h-12 px-6 sm:h-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends useRender.ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ render = <button />, variant, size, className, ...props }: ButtonProps) {
  // useRender gives render-element props precedence, so the type default must
  // live here for a passed type="submit" to win
  return useRender({
    render,
    props: {
      type: "button",
      className: cn(buttonVariants({ variant, size }), className),
      ...props,
    },
  });
}
