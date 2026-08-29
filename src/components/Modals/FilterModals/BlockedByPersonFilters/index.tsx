import {
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { ModalBody } from "reactstrap";
import { Check } from "lucide-react";
import {
  BlockedByPersonOption,
  useBlockedByPersonFilter,
} from "@/hooks/MultiPages/Filters/useBlockedByPersonFilter";
import UserAvatar from "@/components/Common/UserAvatar";

interface IProps {
  closeHandler: (user?: BlockedByPersonOption) => Promise<void>;
}

const BlockedByPersonFilters = ({ closeHandler }: IProps) => {
  const {
    keyword,
    onKeyChange,
    selectedIndex,
    setSelectedIndex,
    filteredPeople,
    enterHandler,
    activeFilters,
  } = useBlockedByPersonFilter({ closeHandler });
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  return (
    <>
      <ModalHeaderComp header="Blocked by person" />
      <ModalBody className="p-0 rounded-b-[4px] outline-off">
        <ModalInput
          id="filter-input"
          value={keyword}
          placeholder="Enter to (un)select"
          onChange={onKeyChange}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="filteredCommandsList"
        >
          {filteredPeople.map((user, index) => (
            <ModalRowElementContainer
              key={user.id}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={enterHandler}
              id={`blocked-by-person-filter-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <div className="flex-grow flex space-x-2 items-center ">
                {user.id === 0 ? (
                  <span className="w-4 sm:w-8 h-4 sm:h-8" />
                ) : (
                  <UserAvatar
                    alt=""
                    compactOnMobile
                    name={user.displayName}
                    photoURL={user.photoURL}
                    size={32}
                    title={user.displayName}
                  />
                )}
                <p className="font-medium ">{user.displayName}</p>
              </div>
              {activeFilters.some((x) => x.id === user.id) ? (
                <Check size={16} strokeWidth={1.75} />
              ) : null}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </>
  );
};

export default BlockedByPersonFilters;
