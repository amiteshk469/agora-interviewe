"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border border-border bg-transparent text-foreground hover:bg-accent",
      },
      size: {
        default: "h-9",
        sm: "h-8 min-h-8 px-2.5 text-xs",
        lg: "h-11 min-h-11 px-5",
        icon: "size-9 min-h-9 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const styles = cn(buttonVariants({ variant, size }), className);
    if (asChild) return <Slot className={styles} ref={ref} {...props}>{children}</Slot>;
    return (
      <button className={styles} ref={ref} disabled={disabled || loading} {...props} aria-busy={loading || props["aria-busy"] || undefined}>
        {loading ? <><LoaderCircle className="animate-spin" aria-hidden="true" /><span className="sr-only" role="status">Loading…</span></> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-6 text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

const badgeVariants = cva(
  "inline-flex min-h-5 w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
  {
    variants: {
      variant: {
        default: "border-primary/30 bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-muted-foreground",
        outline: "border-border text-muted-foreground",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Input({ className, autoComplete = "off", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input autoComplete={autoComplete} className={cn("h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)} {...props} />;
}

export function Textarea({ className, autoComplete = "off", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea autoComplete={autoComplete} className={cn("min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)} {...props} />;
}

export function Select({ className, children, autoComplete = "off", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select autoComplete={autoComplete} className={cn("h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pe-9 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)} {...props}>{children}</select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  const generatedId = React.useId();
  const errorId = `${generatedId}-error`;
  const controlId = React.isValidElement<{ id?: string }>(children) ? children.props.id ?? generatedId : generatedId;
  const control = React.isValidElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>(children)
    ? React.cloneElement(children, {
        id: controlId,
        "aria-describedby": error ? errorId : children.props["aria-describedby"],
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })
    : children;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={controlId}>{label}{required ? <span className="ms-1 text-primary" aria-hidden="true">*</span> : null}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {control}
      {error ? <p id={errorId} className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} role="separator" />;
}

export function Avatar({ initials, src, alt = "", active = false, className }: { initials: string; src?: string; alt?: string; active?: boolean; className?: string }) {
  return (
    <span className={cn("relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-secondary text-xs font-semibold text-muted-foreground", active && "border-primary/60 bg-primary/10 text-primary", className)} aria-hidden={alt ? undefined : "true"}>
      {src ? <Image src={src} alt={alt} fill sizes="48px" className="object-cover" /> : initials}
    </span>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}>
      {steps.map((step, index) => (
        <li key={step} className="min-w-0">
          <div className={cn("mb-2 h-1 rounded-full bg-secondary", index <= current && "bg-primary")} />
          <span className={cn("hidden truncate text-xs text-muted-foreground sm:block", index === current && "text-foreground")}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function CheckRow({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <div className={cn("flex items-start gap-2 text-sm", muted && "text-muted-foreground")}><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><span>{children}</span></div>;
}

export function Alert({ title, children, variant = "default", onDismiss }: { title: string; children: React.ReactNode; variant?: "default" | "destructive"; onDismiss?: () => void }) {
  return (
    <div className={cn("relative rounded-md border bg-secondary/50 p-3 text-sm", variant === "destructive" && "border-destructive/35 bg-destructive/10")} role={variant === "destructive" ? "alert" : "status"}>
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted-foreground">{children}</div>
      {onDismiss ? <Button variant="ghost" size="icon" className="absolute end-1 top-1 size-8" onClick={onDismiss} aria-label="Dismiss"><X aria-hidden="true" /></Button> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden="true" />;
}
