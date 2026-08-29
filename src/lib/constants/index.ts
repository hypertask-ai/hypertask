// globalConstants.ts

import * as APIRoutes from "./APIRouteConstants";
import * as TQKeys from "./TQKeys";
import * as Constants from "./constants";
import * as Theme from "./theneConstants";

const globalConstants = {
  ...APIRoutes,
  ...TQKeys,
  ...Constants,
  ...Theme,
};

export default globalConstants;
