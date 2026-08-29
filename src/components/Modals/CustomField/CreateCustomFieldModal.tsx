import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { currentProjectAtom } from "@/store";
import { CustomFieldType } from "@prisma/client";
import axios from "axios";
import { ChangeEvent, useEffect, useState } from "react";
import { ModalBody } from "reactstrap";
import { useRecoilValue } from "@/lib/state";
import { useQueryClient } from "@tanstack/react-query";

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "Number", label: "Number" },
  { value: "Text", label: "Text" },
  { value: "Date", label: "Date" },
  { value: "Checkbox", label: "Checkbox" },
  { value: "Select", label: "Select" },
];

type Props = {
  closeHandler: () => void;
};

const CreateCustomFieldModal = ({ closeHandler }: Props) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [selectedType, setSelectedType] = useState<CustomFieldType>("Number");
  const [step, setStep] = useState<"name" | "type">("name");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.keyCode === KeyCodes.ESCAPE) {
        closeHandler();
        return;
      }

      if (step === "name") {
        if (e.keyCode === KeyCodes.ENTER && name.trim()) {
          e.preventDefault();
          setStep("type");
          setSelectedIndex(0);
        }
        return;
      }

      // step === "type"
      if (e.keyCode === KeyCodes.ARROW_DOWN) {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < FIELD_TYPES.length - 1 ? prev + 1 : prev
        );
      }
      if (e.keyCode === KeyCodes.ARROW_UP) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      }
      if (e.keyCode === KeyCodes.ENTER) {
        e.preventDefault();
        submitField(FIELD_TYPES[selectedIndex].value);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [step, name, selectedIndex, submitting]);

  async function submitField(type: CustomFieldType) {
    if (submitting || !name.trim()) return; // no-name unreachable via UI: the name step requires it first
    if (!currentProject?.id) {
      setError("Couldn't resolve this board — reload and retry");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await axios.post("/api/customFields", {
        projectId: currentProject.id,
        name: name.trim(),
        type,
      });
      queryClient.invalidateQueries({
        queryKey: ["customFields", currentProject.id],
      });
      closeHandler();
    } catch (err: any) {
      console.error("CreateCustomField error:", err);
      setError(err?.response?.data?.error || "Couldn't create the field. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalContainerCustom
      isOpen
      toggle={closeHandler}
      id="create-custom-field"
      fade={false}
    >
      {step === "name" ? (
        <>
          <ModalHeaderComp header="Create custom field" />
          <ModalBody className="p-0">
            <ModalInput
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setName(e.target.value)
              }
              placeholder="Field name (e.g. ICE Score)"
              id="custom-field-name-input"
            />
          </ModalBody>
        </>
      ) : (
        <>
          <ModalHeaderComp header={`Field type for "${name}"`} />
          <ModalBody className="p-0">
            <ModalListContainer id="custom-field-type-list">
              {FIELD_TYPES.map((t, i) => (
                <ModalRowElementContainer
                  key={t.value}
                  index={i}
                  id={`cf-type-${i}`}
                  isSelected={selectedIndex === i}
                  onClick={() => {
                    setSelectedType(t.value);
                    submitField(t.value);
                  }}
                  handleMouseLeave={() => {}}
                  handleMouseEnter={() => setSelectedIndex(i)}
                >
                  <span>{t.label}</span>
                  {selectedIndex === i && (
                    <span className="text-[#8E9093] text-sm">↵ to select</span>
                  )}
                </ModalRowElementContainer>
              ))}
            </ModalListContainer>
            {error && (
              <p className="text-meta text-red-400 px-3 pb-2" role="alert">
                {error}
              </p>
            )}
          </ModalBody>
        </>
      )}
    </ModalContainerCustom>
  );
};

export default CreateCustomFieldModal;
