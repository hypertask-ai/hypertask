import { Shortcut } from "./commandModals";
import { CommandMode } from "@/models/enums";
import type { useCommandsState } from "./useCommandsState";
import type { createBoardCommandActions } from "./boardCommandActions";
import type { createGeneralCommandActions } from "./generalCommandActions";
import type { createCommandModalCallbacks } from "./commandModalCallbacks";
import type { createCommandDispatcher } from "./commandDispatcher";
import type { IHTCProps } from "./commandTypes";


type Context = Pick<IHTCProps & ReturnType<typeof useCommandsState> & ReturnType<typeof createBoardCommandActions> & ReturnType<typeof createGeneralCommandActions> & ReturnType<typeof createCommandModalCallbacks> & ReturnType<typeof createCommandDispatcher>, "commandMode">;

export function renderCommandModals1(context: Context) {
  const {
  commandMode,
  } = context;
  return (<>
      {commandMode === CommandMode.Shortcut && <Shortcut />}
     </>);
}
