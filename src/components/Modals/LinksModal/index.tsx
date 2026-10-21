import { ITask, IUrl } from "@/models/model";
import { useEffect, useRef, useState } from "react";
import { ModalBody } from "reactstrap";
import styles from '@/styles/linksModal.module.scss'
import { useRouter } from "next/navigation";

import { Link, Search } from "lucide-react";
import dynamic from 'next/dynamic';
import { ModalContainerCustom, ModalHintBar, ModalInput, ModalListContainer, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7050_CTRL_O_LINKS_FLAG } from "@/lib/flags/keys";
const AttachmentCarousel = dynamic(() => import("@/components/Common/AttachmentsView/AttachmentsCarousel"), { ssr: false })
interface IProps {
  display: boolean;
  onClose: any;
  currentTaskId: number;
  commentId: string;
  subTasks?: ITask[];
  relatedTasks?: ITask[];
  parentTask?: ITask;
}
const LinksModal = ({ display, onClose, currentTaskId, commentId, subTasks, parentTask, relatedTasks = [] }: IProps) => {
  const savedLinksEnabled = useFlag(HTPR_7050_CTRL_O_LINKS_FLAG);
  const linksInputRef = useRef<HTMLInputElement>(null)

  const [modal, setModal] = useState<boolean>(display);
  const [keyboardControls, enableKeyboardControls] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [isModalOpen, setModalOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })

  const router = useRouter();

  const [filteredLinks, setFilteredLinks] = useState<IUrl[]>([])
  const [links, setLinks] = useState<IUrl[]>([])
  const [galleryAttachments, setGalleryAttachments] = useState<any>([]);

  const [inputValue, setInputValue] = useState<string>("");
  const handleChange = (e: any) => {

    setInputValue(e.target.value)
    const filteredResults = links.filter((item) =>
      item.title?.toLowerCase().includes(e.target.value.toLowerCase())
    )
    setFilteredLinks(filteredResults)
  }

  const addSubAndParentTasks = (): IUrl[] => {
    let responseArray: IUrl[] = [];
    if (parentTask) {
      responseArray.push({
        title: parentTask.title,
        projectId: parentTask.projectId,
        urlString: `/detail/project-${parentTask.projectId}/${parentTask.uniqueIndex}`,
        TaskId: parentTask.id,
        id: parentTask.id,
        ticketNumber: parentTask.ticketNumber,
      });
    }
    if (subTasks && subTasks.length > 0) {
      subTasks.forEach((task) => {
        responseArray.push({
          title: task.title,
          projectId: task.projectId,
          urlString: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
          TaskId: task.id,
          id: task.id,
          ticketNumber: task.ticketNumber,
        });
      });
    }
    return responseArray;
  };

  const onOpenHandler = async () => {
    setLoading(true)
    enableKeyboardControls(true)

    const response = await fetch(`/api/urls/fetchUrls?taskId=${currentTaskId}&commentId=${commentId}`)
    if (response.ok) {
      let responseArray: IUrl[] = []
      const res: IUrl[] = await response.json();
      
      if(commentId === descriptionContainerId){
        responseArray = [...addSubAndParentTasks(), ...res]
      }else{
        responseArray = [...res, ...addSubAndParentTasks()]
      }

      const legacyGalleryLinks = res.filter(item => /\.(pdf|png|webp|jpg|jpeg|txt|code|mp4|docx|mov|xlsx|pptx|webm|)$/i.test(item.urlString) && item.urlString.startsWith("https://files.hypertask.app/"));
      const galleryLinks = savedLinksEnabled ? res.filter(item => item.Attachment || legacyGalleryLinks.includes(item)) : legacyGalleryLinks;
      const filteredGalleryAttachment = galleryLinks
        .map(({ urlString, title, attachmentType }) => {
          const extension = urlString.toLowerCase().match(/\.\w+$/) || [''];
          const legacyFileType = /\.(png|webp|jpg|jpeg)$/i.test(extension[0]) ?
            `image/${extension[0].split(".")[1]}` :
            `${extension[0].split(".")[1] === "mp4" || extension[0].split(".")[1] === "mov" || extension[0].split(".")[1] === "webm" ? "video/quicktime" : ""}${extension[0].split(".")[1]}`;
          const fileType = savedLinksEnabled ? attachmentType || legacyFileType : legacyFileType;
          return { fileSource: urlString, fileType, fileName: title };
        });
      
      setGalleryAttachments(filteredGalleryAttachment)
      setLinks(responseArray)
      setFilteredLinks(responseArray)
      setSelectedIndex(0)
    } else{
      let responseArray: IUrl[] = [...addSubAndParentTasks()]
        setGalleryAttachments([])
        setLinks(responseArray)
        setFilteredLinks(responseArray)
        setSelectedIndex(0)
      }
    

  

    setLoading(false)
  }

  const handleLinkClick = (link: IUrl) => {
    const isAttachment = savedLinksEnabled ? galleryAttachments.some((attachment: { fileSource: string }) => attachment.fileSource === link.urlString) : link.urlString.startsWith("https://files.hypertask.app/");
    if (isAttachment) {
      const index = galleryAttachments.findIndex((attachment: { fileSource: string; }) => attachment.fileSource === link.urlString)
      setCurrentIndex(index)
      toggleModal()

    }
    else {
      var href = link.urlString;
      if (href && href.includes('app.hypertask') || href.startsWith("/detail")) {
        router.push(href)

      }
      else window.open(href, '_blank');

      toggle()
    }
  }
  const toggle = () => {
    setModal(!modal)
    onClose()
  };

  const toggleModal = () => {
    setModalOpen(!isModalOpen);

  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const selectedUrl = filteredLinks[selectedIndex]
    if (!selectedUrl) return 
    if (event.key === "Escape") {
      setModal(false)
      onClose()
    }
    if (event.key === "ArrowDown") {
      if (selectedUrl) {
        if (selectedIndex === -1 || selectedIndex === (filteredLinks.length - 1)) {
        } else {
          setSelectedIndex(prev=>prev+1)
          document.getElementById(`task_${selectedIndex+1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        if (links.length > 0) {
          setSelectedIndex(0)
          document.getElementById(`task_${0}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
    else if (event.key === "ArrowUp") {
      if (selectedUrl) {
        if (selectedIndex <= 0) {
        } else {
          setSelectedIndex(prev=>prev-1)
          document.getElementById(`task_${selectedIndex - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        if (links.length > 0) {
          setSelectedIndex(filteredLinks.length - 1)
          document.getElementById(`task_${filteredLinks.length - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
    else if (event.key === "Enter" ) return handleLinkClick(selectedUrl)

  }

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [keyboardControls, filteredLinks, links, selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredLinks]);
  return (
    <>

      {isModalOpen ?
        <AttachmentCarousel
          closeCallback={toggleModal}
          attachments={galleryAttachments}
          currentIndex={currentIndex} />
        :
        <ModalContainerCustom
          id="LinksModal"
          fade={false}
          isOpen={modal} show={true} onOpened={onOpenHandler}
          toggle={toggle} autoFocus={false}
          className={`paletteModalSizing sm:max-h-fit sm:top-[24%] sm:min-w-[560px] ${styles.links_modal}`}
          contentClassName="rounded-[5px] overflow-hidden">
          {
            !loading &&
            <>

              <ModalBody className='p-0 rounded-[5px]'>
                <div className="flex items-center gap-2.5 border-b border-light-black-border-1 px-4">
                  <Search strokeWidth={1.75} size={13} className="shrink-0 text-text-light-gray" />
                  <ModalInput
                    id='linksModal'
                    placeholder="Open a link..."
                    ref={linksInputRef}
                    value={inputValue}
                    onChange={handleChange}
                    className="px-0"
                  />
                </div>

                <ModalListContainer
                  handleMouseMove={handleMouseMove}
                  id="users-list"
      
                  aria-labelledby="assignDelayButton"
                >
                  {
                    links &&
                    filteredLinks.map((link: IUrl, index: number) => (
                      <ModalRowElementContainer
                        id={`task_${index}`}
                        onMouseEnter={() => handleMouseEnter(index)}
                        onMouseLeave={handleMouseLeave}
                        key={index}
                        onClick={() => handleLinkClick(link)}
                        isSelected={selectedIndex===index}
                        className="justify-start"
                      >
                        <Link size={13} strokeWidth={1.75} className="shrink-0 text-text-light-gray" />
                        <span className="flex min-w-0 flex-grow items-center gap-2">
                          {link.ticketNumber && (
                            <span className="shrink-0 text-text-light-gray">
                              {link.ticketNumber}
                            </span>
                          )}
                          <span className="truncate">
                            {link?.title ? link?.title : link?.urlString}
                          </span>
                        </span>
                      </ModalRowElementContainer>
                     
                    ))
                  }

                </ModalListContainer>
                <ModalHintBar />

              </ModalBody>
            </>
          }
        </ModalContainerCustom>
      }
    </>

  );
}

export default LinksModal;
