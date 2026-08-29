import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import React, { useEffect, useState } from "react";
import { ModalHeader } from "reactstrap";
import { IUser } from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { EmailVerificationContent } from "@/components/EmailVerification/EmailVerificationContent";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { useEmailVerificationStatus } from "@/hooks/useEmailVerificationStatus";

interface IEmailVerificationModal {
  currentUser: IUser | null;
  onVerified: () => void;
}

const EmailVerificationModal: React.FC<IEmailVerificationModal> = ({
  onVerified,
}) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const [email, setEmail] = useState<string>('');

  // Use unified verification status hook with polling enabled
  const { status } = useEmailVerificationStatus({
    userId: currentUser?.id,
    enablePolling: true,
    pollingInterval: 3000,
    onVerified,
  });

  const { isResending, errorMessage, handleResend } = useResendVerificationEmail();

  // Set email from current user
  useEffect(() => {
    if (currentUser?.email) {
      setEmail(currentUser.email);
    }
  }, [currentUser]);

  const handleResendClick = () => {
    handleResend(email);
  };

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="email-verification-modal"
      toggle={() => {}}
      shouldCloseOnClickOutside={false}
      contentClassName="h-full"
      fullScreen={true}
      className="bg-black border-none sm:w-full md:min-w-[900px] flex flex-col"
    >
      <ModalHeader className="rounded-none border-b-0 h-[60px] pl-[24px] text-subheading font-bold [&>*:first-child]:w-full">
        <div className="flex justify-end items-center w-full">
          {/* No close button - user must verify */}
        </div>
      </ModalHeader>
      
      <div className="flex-1 bg-gradient-dark flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <EmailVerificationContent
            email={email}
            isResending={isResending}
            errorMessage={errorMessage}
            onResend={handleResendClick}
          />
        </div>
      </div>
    </ModalContainerCustom>
  );
};

export default EmailVerificationModal;

