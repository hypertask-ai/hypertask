
import { Trash2 } from "lucide-react";

interface ResizableMediaAction {
  tooltip: string;
  icon?: any;
  action?: (updateAttributes: (o: Record<string, any>) => any) => void;
  isActive?: (attrs: Record<string, any>) => boolean;
  delete?: (d: () => void) => void;
}

export const resizableMediaActions: ResizableMediaAction[] = [
  {
    tooltip: "Delete",
    icon: Trash2,
    delete: (deleteNode) => deleteNode(),
  },
];
