"use client";

import {
  CLI_DOCS_URL,
  INSTALL_COMMAND,
  LOGIN_COMMAND,
} from "@/components/Modals/CliInstall/constants";
import SettingsCard from "./SettingsCard";
import SettingsCodeRow from "./SettingsCodeRow";
import SettingsSectionShell from "./SettingsSectionShell";

const CliSection = () => {
  return (
    <SettingsSectionShell title="CLI">
      <SettingsCard title="Install">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Install the Hypertask command-line interface on macOS or Linux.
        </p>
        <SettingsCodeRow value={INSTALL_COMMAND} />
      </SettingsCard>

      <SettingsCard title="Sign In">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Authorize the CLI in your browser for this Hypertask account.
        </p>
        <SettingsCodeRow value={LOGIN_COMMAND} />
      </SettingsCard>

      <SettingsCard title="Next Steps">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Run <code className="text-white-black">hypertask --help</code> to see
          every available task, project, comment, and inbox command.
        </p>
        <a
          className="w-fit rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active"
          href={CLI_DOCS_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Read the CLI docs
        </a>
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default CliSection;
