import { useState } from "react";
import SignOutModal from "@/components/Modals/SignOut/SignOutModal";
import { SingleSectionContentTitle } from "./Single section items";

const Signout = () => {
  const [showConfirmation, setShowConfirmation] = useState(false);

  return (
    <>
      <SingleSectionContentTitle
        id="signout-button"
        title="Sign Out"
        onClick={() => setShowConfirmation(true)}
      />
      {showConfirmation && (
        <SignOutModal closeHandler={() => setShowConfirmation(false)} />
      )}
    </>
  );
};

export default Signout;
