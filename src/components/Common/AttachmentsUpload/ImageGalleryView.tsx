/* eslint-disable jsx-a11y/alt-text */
/* eslint-disable @next/next/no-img-element */
import React, { useState, useEffect, useCallback } from "react";
import { Modal, ModalBody, Container } from "reactstrap";
import "@/styles/AttachmentView.scss";
import dynamic from "next/dynamic";
import { useRecoilState } from "@/lib/state";
import { uploadingStateCreateTaskModalAtom } from "@/store";
import { createRemoveHandler } from "./createRemoveHandler";

const SingleFileInputPreview = dynamic(()=>import("./SingleFileInputPreview"))
// import SingleFileInputPreview from "./SingleFileInputPreview";



interface IProps {
  images: any;
  files: any[] | [];
  handleRemove: any;
  shouldUpload: boolean;
  mode:"others"|"Creating task"
  allowDelete?: boolean;
  callbackAttachments?:any;
  variant?: "default" | "chat";
}
const ImageGallery = (props: IProps) => {
  const {files, mode, callbackAttachments, allowDelete, handleRemove, shouldUpload, variant = "default"} = props
  const [isModalOpen, setModalOpen] = useState(false);
  const [files_, setFiles] = useState<any[]>(files ?? [[]]);
  // console.log("🚀 ~ ImageGallery ~ files_:", files_)
  // console.log("🚀 ~ ImageGallery ~ files:", files)
  const [selectedFile, setSelectedFile] = useState<null | any>(null);
  const [canSave,setUploadingStateCreateTaskModal ] = useRecoilState(uploadingStateCreateTaskModalAtom)
  // console.log("🚀 ~ ImageGallery ~ canSave:", canSave)
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  // console.log("🚀 ~ ImageGallery ~ uploadedFiles:", uploadedFiles)
  

  const toggleModal = () => setModalOpen(prev=>!prev);

  const showModalImage = (index: number) => {
    toggleModal();
    setSelectedFile(files[index].file);
  };

  useEffect(() => {
    setFiles(files);
    
  }, [files]);

  
  const sendBack = useCallback(
    (attachmentReturned:any) => {
      console.log("ran")
      if (uploadedFiles.length===files_.length) return
      // here we will send back ALL THE STRINGS
      setUploadedFiles((prev)=>[...prev, attachmentReturned])
    },
    [files_.length, uploadedFiles.length],
  )

  useEffect(() => {
    if (mode!=="Creating task") return
    if (uploadedFiles.length !== files_.length){
      console.log("Checking status: Upload in progress")
      setUploadingStateCreateTaskModal({
        uploaded:uploadedFiles.length,
        attached:files_.length,
        canUpload:false
      })
    }
    else{
      console.log("Checking status: Ready to save")    
      setUploadingStateCreateTaskModal({
        uploaded:uploadedFiles.length,
        attached:files_.length,
        canUpload:true
      })
    } 
  }, [files_.length, uploadedFiles.length])
  
  const removeHandler = createRemoveHandler({ mode, setUploadedFiles, handleRemove })

  useEffect(() => {
    
    if (uploadedFiles.length===files_.length || files_.length===0){
        callbackAttachments&&callbackAttachments(uploadedFiles)
    } 
    
  }, [uploadedFiles.length, files_.length])
  
  return (
    <>
      <div className={`flex flex-wrap gap-2 p-0 m-0 ${variant === "chat" ? "w-full min-w-0" : ""}`}>
        {files_.map(({ file,id }, index) => {
          console.log("🚀 ~ ImageGallery ~ file:", file)
          if (!file) return <></>
          return (
            <SingleFileInputPreview
              id={id}
              shouldUpload={shouldUpload}
              key={`Single-file-${file.name}`}
              file={file}
              index={index}
              allowDelete={allowDelete}
              showModalImage={showModalImage}
              callback={sendBack}
              handleRemove={removeHandler}
              variant={variant}
            />
          )
        })}
      </div>
      {selectedFile && !shouldUpload && (
        <Modal
          fade={false}
          onKeyDown={(e) => {
            if (e.key === "Escape") toggleModal();
          }}
          size="lg"
          className="w-[90vw] modal-container preview-modal"
          isOpen={isModalOpen && selectedFile}
          toggle={toggleModal}
        >
          <ModalBody className="h-screen bg-transparent">
            <div
              id="topSection"
              className=" flex items-center  w-full  justify-center gap-2"
            >
              {/* ============ left download button ================ */}
              {/* ============ center  text================= */}
              <div
                id="center"
                className="center-container  max-w-[85%] sm:min-w-[600px] flex justify-center items-center gap-2"
              >
                <span
                  id="centerLogo"
                  className=" text-black bg-white text-content rounded-[2px] p-1 h-fit"
                >
                  {selectedFile.type.split("/")?.pop()?.toUpperCase()}
                </span>
                <h1
                  id="centerText"
                  className=" text-content my-3 overflow-auto text-white-blackfont-extrabold"
                >
                  {selectedFile.name}
                </h1>
              </div>

              {/* ============ right Cross ================== */}
              <svg
                onClick={toggleModal}
                className="close-button cursor-pointer"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M15.7656 14.6336C15.8399 14.708 15.8988 14.7962 15.9391 14.8933C15.9793 14.9904 16 15.0945 16 15.1996C16 15.3047 15.9793 15.4088 15.9391 15.5059C15.8988 15.603 15.8399 15.6912 15.7656 15.7656C15.6912 15.8399 15.603 15.8988 15.5059 15.9391C15.4088 15.9793 15.3047 16 15.1996 16C15.0945 16 14.9904 15.9793 14.8933 15.9391C14.7962 15.8988 14.708 15.8399 14.6336 15.7656L8 9.13094L1.36637 15.7656C1.21626 15.9157 1.01268 16 0.8004 16C0.588121 16 0.384536 15.9157 0.234432 15.7656C0.0843276 15.6155 4.18453e-09 15.4119 0 15.1996C-4.18453e-09 14.9873 0.0843276 14.7837 0.234432 14.6336L6.86906 8L0.234432 1.36637C0.0843276 1.21626 -1.5816e-09 1.01268 0 0.8004C1.5816e-09 0.588121 0.0843276 0.384536 0.234432 0.234432C0.384536 0.0843276 0.588121 1.5816e-09 0.8004 0C1.01268 -1.5816e-09 1.21626 0.0843276 1.36637 0.234432L8 6.86906L14.6336 0.234432C14.7837 0.0843276 14.9873 -4.18453e-09 15.1996 0C15.4119 4.18453e-09 15.6155 0.0843276 15.7656 0.234432C15.9157 0.384536 16 0.588121 16 0.8004C16 1.01268 15.9157 1.21626 15.7656 1.36637L9.13094 8L15.7656 14.6336Z"
                  fill="white"
                />
              </svg>
            </div>
            <div className="d-flex h-full items-center justify-content-center ">
              {selectedFile.type.startsWith("image/") ? (
                <img
                  // style={{width:"100%",  objectFit:"contain"}}
                  loading="lazy"
                  className="image-fluid object-contain carousel-image max-w-[84vw] max-h-[84%]"
                  src={
                    selectedFile.source
                      ? selectedFile.source
                      : URL.createObjectURL(selectedFile)
                  }
                />
              ) : (
                <embed
                  className="sm:min-h-[70svh] carousel-document max-w-[84vw] max-h-[84%]"
                  type={selectedFile.type}
                  width={"100%"}
                  src={
                    selectedFile.source
                      ? selectedFile.source
                
                      : URL.createObjectURL(selectedFile)
                  }
                />
              )}
            </div>

            {/* // src={"https://www.africau.edu/images/default/sample.pdf"} /> */}
          </ModalBody>
        </Modal>
      )}
    </>
  );
};

export default ImageGallery;
