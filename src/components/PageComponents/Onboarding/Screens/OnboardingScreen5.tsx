import { IOnboardingScreen } from "@/models/model";
import { useState, useLayoutEffect, useCallback } from "react";
import { getTeamInviteUrl } from "@/lib/serverActions";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import toast from "react-hot-toast";
import useInviteCallbackHandlers from "@/hooks/MultiPages/useInviteCallbackHandlers";
import { GetStartedButton } from "../GetStartedButton";

interface IOnboardingScreen5 extends IOnboardingScreen {
  teamToInviteTo: {
    id: string;
    title: string;
  };
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const OnboardingScreen5: React.FC<IOnboardingScreen5> = ({
  onNextScreen,
  teamToInviteTo,
}) => {
  const [_currentProject, _] = useRecoilState(currentProjectAtom);
  const currentUser = useCurrentUser();
  const [emails, setEmails] = useState<string>("");
  const [emailErrors, setEmailErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [project, setProject] = useState<any>();
  const { inviteNewMembersToBoard } = useInviteCallbackHandlers();

  const api = useCallback(async () => {
    if (!currentUser) return;
    const response = await getTeamInviteUrl(currentUser?.id, teamToInviteTo.id);
    if (response && response !== "Error") {
      setProject(response.projectFirst);
    }
  }, [currentUser]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setEmails(value);
    setHasAttemptedSubmit(false);

    if (emailErrors.length > 0) {
      setEmailErrors([]);
    }
  };

  const validateEmails = (): boolean => {
    if (!emails.trim()) {
      return true;
    }

    const emailList = emails
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    const invalidEmails: string[] = [];

    emailList.forEach((email) => {
      if (!emailRegex.test(email)) {
        invalidEmails.push(email);
      }
    });

    setEmailErrors(invalidEmails);
    return invalidEmails.length === 0;
  };

  useLayoutEffect(() => {
    api();
  }, [api, currentUser]);

  const onClickSendInvites = () => {
    setHasAttemptedSubmit(true);

    if (!currentUser) {
      toast.error("User not found. Please refresh and try again.");
      return;
    }

    const isValid = validateEmails();

    if (!isValid) {
      toast.error("Please fix the invalid email addresses before continuing.");
      return;
    }

    // If there are valid emails, send invites
    if (emails.trim()) {
      const emailList = emails
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0);

      if (emailList.length > 0) {
        inviteNewMembersToBoard(emailList, project, currentUser);
        toast.success("Invites sent successfully!");
      }
    }

    onNextScreen();
  };

  return (
    <div className="flex flex-col gap-6 items-center justify-center max-w-[600px] mx-auto px-4 cursor-default">
      <div className="text-center space-y-3">
        <h2 className="text-heading sm:text-display font-semibold text-white-black">
          Invite co-workers to your team
        </h2>
        <p className="text-text-light-gray text-emphasis">
          Hypertask is meant to be used with your team. Invite some co-workers
          to test it out with.
        </p>
      </div>

      <div className="w-full">
        <div className="shadow-customshadow-2 bg-comment-description rounded border-thin border-border-light-gray-thin p-6 space-y-4 text-white-black flex flex-col items-end">
          <EmailInput
            onChange={onChange}
            emails={emails}
            emailErrors={emailErrors}
            hasAttemptedSubmit={hasAttemptedSubmit}
          />
          <GetStartedButton onClick={onClickSendInvites} text="Send invites" />
        </div>
      </div>

      <button
        className="text-text-light-gray hover:underline transition-all duration-200"
        onClick={onNextScreen}
      >
        I&apos;ll do this later
      </button>
    </div>
  );
};

interface IEmailInputProps {
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  emailErrors: string[];
  emails: string;
  hasAttemptedSubmit: boolean;
}

const EmailInput: React.FC<IEmailInputProps> = ({
  onChange,
  emails,
  emailErrors,
  hasAttemptedSubmit,
}) => {
  const hasErrors = hasAttemptedSubmit && emailErrors.length > 0;

  return (
    <div className="space-y-3 w-full">
      <label className="block text-content font-medium text-white-black">
        Email
      </label>

      <textarea
        className={`w-full text-content px-3 py-3 transition-colors duration-200 resize-none bg-active-list-element outline-none p-2 font-normal text-white-black rounded`}
        onChange={onChange}
        value={emails}
        placeholder="email@example.com, email2@example.com..."
        rows={5}
      />

      {hasErrors && (
        <div className="space-y-1">
          <p className="text-red-400 text-meta">Invalid email addresses:</p>
          <ul className="text-red-400 text-meta space-y-1">
            {emailErrors.map((email, index) => (
              <li key={index} className="ml-2">
                • {email}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
