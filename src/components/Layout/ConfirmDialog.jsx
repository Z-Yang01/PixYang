import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
  onCancel,
}) {
  // radix 的 Action 点击后自带关闭流程会回调 onOpenChange(false)：
  // 不隔离的话「确认」会连带执行一次「取消」
  const confirmedRef = useRef(false);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (open) return;
        if (confirmedRef.current) {
          confirmedRef.current = false;
          return;
        }
        onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction
            className={danger ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
