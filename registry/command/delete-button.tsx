import type { CommandDescriptor, ResourceScope } from "@fleetly/fleet-ui-kit/kernel";
import { useCommand } from "@fleetly/fleet-ui-kit/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * DeleteButton（command 块）—— 行删除的完整接线：确认框 + 命令 + 默认失效。
 * 双 console 的 RowDelete/DeleteButton 对应物。
 */
export interface DeleteButtonProps<Input, Payload, ID> {
  descriptor: CommandDescriptor<Input, Payload, ID>;
  input: Input;
  scope?: ResourceScope;
  label?: string;
  confirmTitle?: string;
  confirmDescription?: string;
}

export function DeleteButton<Input, Payload, ID>({
  descriptor,
  input,
  scope,
  label = "Delete",
  confirmTitle = "Delete this record?",
  confirmDescription = "This action cannot be undone.",
}: DeleteButtonProps<Input, Payload, ID>) {
  const [open, setOpen] = useState(false);
  const command = useCommand(descriptor, { scope });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        onClick={() => setOpen(true)}
        disabled={command.pending}
      >
        <Trash2 className="size-3.5 text-err" />
      </Button>
      <ConfirmDialog
        open={open}
        title={confirmTitle}
        description={confirmDescription}
        onConfirm={() => {
          setOpen(false);
          command.mutate(input);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
