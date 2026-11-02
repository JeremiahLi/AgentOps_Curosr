"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  isFullscreen?: boolean;
  minWidth?: string;
  maxWidth?: string;
}

export function SlidePanel({ open, onClose, children, width = 75, isFullscreen = false, minWidth = "700px", maxWidth = "1200px" }: Props) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          "absolute bottom-0 right-0 top-0 border-l border-border bg-background shadow-2xl animate-slide-in-right flex flex-col",
          isFullscreen && "left-0",
        )}
        style={isFullscreen ? undefined : { width: `${width}%`, maxWidth, minWidth }}
      >
        {children}
      </div>
    </div>
  );
}
