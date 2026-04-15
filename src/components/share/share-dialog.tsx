"use client";

interface ShareDialogProps {
  fileId?: string;
  fileName?: string;
  isFolder?: boolean;
  open?: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}

export function ShareDialog(_props: ShareDialogProps) {
  return null;
}
