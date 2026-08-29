/* @unocss-include */
// import { IconAlignCenter, IconAlignLeft, IconAlignRight, IconFloatLeft, IconFloatRight, IconDelete } from '~/assets'

import { Trash2 } from "lucide-react";

interface ResizableMediaAction {
  tooltip: string;
  icon?: any;
  action?: (updateAttributes: (o: Record<string, any>) => any) => void;
  isActive?: (attrs: Record<string, any>) => boolean;
  delete?: (d: () => void) => void;
}

export const resizableMediaActions: ResizableMediaAction[] = [
  // {
  //   tooltip: "Align left",
  //   action: (updateAttributes) =>
  //     updateAttributes({
  //       dataAlign: "start",
  //       dataFloat: null,
  //     }),
  //   icon: FaAlignLeft,
  //   isActive: (attrs) => attrs.dataAlign === "start",
  // },
  // {
  //   tooltip: "Align center",
  //   action: (updateAttributes) =>
  //     updateAttributes({
  //       dataAlign: "center",
  //       dataFloat: null,
  //     }),
  //   icon: FaAlignCenter,
  //   isActive: (attrs) => attrs.dataAlign === "center",
  // },
  // {
  //   tooltip: "Align right",
  //   action: (updateAttributes) =>
  //     updateAttributes({
  //       dataAlign: "end",
  //       dataFloat: null,
  //     }),
  //   icon: FaAlignRight,
  //   isActive: (attrs) => attrs.dataAlign === "end",
  // },
  {
    tooltip: "Delete",
    icon: Trash2,
    delete: (deleteNode) => deleteNode(),
  },
];
