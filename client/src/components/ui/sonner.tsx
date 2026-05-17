import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "!bg-panel !border !border-border !text-text !font-mono !text-xs !rounded-none",
          description: "!text-text-dim",
          actionButton: "!bg-green !text-black",
          cancelButton: "!bg-panel-2 !text-text-dim",
          error: "!border-red/40",
          success: "!border-green/40",
        },
      }}
      style={
        {
          "--normal-bg": "var(--panel)",
          "--normal-text": "var(--text)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
