"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, CircleXIcon, Loader2Icon, XIcon } from "lucide-react"

/**
 * Outlook-style notification: a flat card with Fluent elevation, plain text, a text
 * action in the accent color and a dismiss button on the right. Color is reserved for
 * the status icon.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      gap={8}
      visibleToasts={3}
      offset={{ bottom: 16, left: 16 }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <CircleXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        close: <XIcon className="size-3.5" />,
      }}
      style={{ "--width": "400px" } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group/toast flex w-(--width) items-start gap-3 rounded-[6px] border border-border/70 bg-pane py-3 pr-2 pl-4 text-[13px] text-foreground shadow-[0_8px_16px_rgba(0,0,0,0.14),0_0_2px_rgba(0,0,0,0.12)] dark:border-white/10 dark:shadow-[0_8px_16px_rgba(0,0,0,0.4),0_0_2px_rgba(0,0,0,0.3)]",
          icon:
            "mt-0.5 flex size-4 shrink-0 items-center justify-center text-brand group-data-[type=error]/toast:text-destructive group-data-[type=success]/toast:text-green-700 group-data-[type=warning]/toast:text-amber-600 dark:group-data-[type=success]/toast:text-green-400 dark:group-data-[type=warning]/toast:text-amber-400",
          content: "flex min-w-0 flex-1 flex-col gap-0.5 py-px",
          title: "leading-5 break-words",
          description: "text-[12px] leading-4 text-subtle break-words",
          actionButton:
            "-my-1 h-7 shrink-0 cursor-pointer rounded-sm px-2 text-[13px] font-semibold text-brand transition-colors hover:bg-hover",
          cancelButton:
            "-my-1 h-7 shrink-0 cursor-pointer rounded-sm px-2 text-[13px] text-subtle transition-colors hover:bg-hover hover:text-foreground",
          // Sonner styles [data-close-button] even when unstyled, with higher specificity.
          closeButton:
            "order-last -my-0.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm !border-0 !bg-transparent !text-subtle transition-colors hover:!bg-hover hover:!text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
