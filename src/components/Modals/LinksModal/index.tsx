import { ITask, IUrl } from "@/models/model";
import { useEffect, useRef, useState } from "react";
import { ModalBody } from "reactstrap";
import styles from '@/styles/linksModal.module.scss'
import { useRouter } from "next/navigation";

import { Link, Search } from "lucide-react";
// import AttachmentCarousel from "@/components/Common/AttachmentsView/AttachmentsCarousel";
import dynamic from 'next/dynamic';
import { ModalContainerCustom, ModalHintBar, ModalInput, ModalListContainer, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
const AttachmentCarousel = dynamic(() => import("@/components/Common/AttachmentsView/AttachmentsCarousel"), { ssr: false })
interface IProps {
  display: boolean;
  onClose: any; // Change 'any' to the specific function type if possible
  currentTaskId: number;
  commentId: string;
  subTasks?: ITask[];
  relatedTasks?: ITask[];
  parentTask?: ITask;
}
const LinksModal = ({ display, onClose, currentTaskId, commentId, subTasks, parentTask, relatedTasks = [] }: IProps) => {
  // --------------- Refs
  const linksInputRef = useRef<HTMLInputElement>(null)

  // ---------------- state handlers
  const [modal, setModal] = useState<boolean>(display);
  const [keyboardControls, enableKeyboardControls] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  // const [_selectedUrl, setSelectedUrl] = useState<IUrl | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })

  const router = useRouter();

  // ---------------- linksToDisplay 
  const [filteredLinks, setFilteredLinks] = useState<IUrl[]>([])
  const [links, setLinks] = useState<IUrl[]>([])
  const [galleryAttachments, setGalleryAttachments] = useState<any>([]);

  // -------------------- input handlers
  const [inputValue, setInputValue] = useState<string>("");
  const handleChange = (e: any) => {

    setInputValue(e.target.value)
    const filteredResults = links.filter((item) =>
      item.title?.toLowerCase().includes(e.target.value.toLowerCase())
    )
    setFilteredLinks(filteredResults)
    // setFilteredLinks((prev)=> links.filter((link: IUrl) =>
    //     e.target.value
    //       ? link.title?.toLowerCase().includes(e.target.value.toLowerCase())
    //       : true
    //   ))
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
    // if(relatedTasks && relatedTasks.length > 0) {
    //   relatedTasks.forEach((task) => {
    //     responseArray.push({
    //       title: task.title,
    //       projectId: task.projectId,
    //       urlString: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
    //       TaskId: task.id,
    //       id: task.id,
    //       ticketNumber: task.ticketNumber,
    //     });
    //   });
    // }
    return responseArray;
  };

  // -------------------- ON MODAL LOAD
  const onOpenHandler = async () => {
    setLoading(true)
    enableKeyboardControls(true) // force focus on input field

    const response = await fetch(`/api/urls/fetchUrls?taskId=${currentTaskId}&commentId=${commentId}`) // fetch all links
    if (response.ok) {
      let responseArray: IUrl[] = []
      const res: IUrl[] = await response.json();
      
      if(commentId === descriptionContainerId){
        responseArray = [...addSubAndParentTasks(), ...res]
      }else{
        responseArray = [...res, ...addSubAndParentTasks()]
      }
      // console.log("🚀 ~ file: index.tsx:65 ~ onOpenHandler ~ responseArray:", responseArray)

      const filteredGalleryAttachment = res
        .filter(item => /\.(pdf|png|webp|jpg|jpeg|txt|code|mp4|docx|mov|xlsx|pptx|webm|)$/i.test(item.urlString) && item.urlString.startsWith("https://files.hypertask.app"))
        .map(({ urlString, title }) => {
          const extension = urlString.toLowerCase().match(/\.\w+$/) || ['']; // Extract file extension
          return {
            fileSource: urlString,
            fileType: /\.(png|webp|jpg|jpeg)$/i.test(extension[0]) ?
              `image/${extension[0].split(".")[1]}` :
              `${extension[0].split(".")[1] === "mp4" || extension[0].split(".")[1] === "mov" || extension[0].split(".")[1] === "webm" ? "video/quicktime" : ""}${extension[0].split(".")[1]}`,
            fileName: title,
          };
        });
      console.log("🚀 ~ file: index.tsx:83 ~ onOpenHandler ~ filteredGalleryAttachment:", filteredGalleryAttachment)
      
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
    // console.log("🚀 ~ file: LinksModal.tsx:35 ~ onOpenHandler ~ links:", links)

  }

  // ---------------------- LINK CLICK HANDLER ------------------
  const handleLinkClick = (link: IUrl) => {
    if (link.urlString.startsWith("https://files.hypertask.app")) {
      const index = galleryAttachments.findIndex((attachment: { fileSource: string; }) => attachment.fileSource === link.urlString)
      setCurrentIndex(index)
      toggleModal()

    }
    else {
      var href = link.urlString;
      // Check if the href contains the domain 'app.hypertask.ai'
      if (href && href.includes('app.hypertask') || href.startsWith("/detail")) {
        // Call your custom function here
        router.push(href)

      }
      else window.open(href, '_blank'); // Open the URL in a new tab

      toggle()
    }
  }
  // ---------------------- MODAL CLOSE HANDLER -----------------
  const toggle = () => {
    setModal(!modal)
    // setAssignKeyword("")
    onClose()
  };

  // ----------------------- close gallery modal
  const toggleModal = () => {
    setModalOpen(!isModalOpen);

  };

  //  ============================= KEYBOARD NAVIGATION HANDLER =============================
  const handleKeyDown = (event: KeyboardEvent) => {
    // console.log('im working at least')
    const selectedUrl = filteredLinks[selectedIndex]
    if (!selectedUrl) return 
    // ------------------------------ DOWN MOVEMENT ------------------------------
    if (event.key === "Escape") {
      setModal(false)
      onClose()
    }
    if (event.key === "ArrowDown") {
      // down
      if (selectedUrl) {
        // ------ at bottom of list
        if (selectedIndex === -1 || selectedIndex === (filteredLinks.length - 1)) {
          // setSelectedUrl(links[0])
          // document.getElementById(`task-${links[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

      // ------------------------------ UP MOVEMENT ------------------------------
    }
    else if (event.key === "ArrowUp") {
      // up
      if (selectedUrl) {
        // ------ at top of list
        if (selectedIndex <= 0) {
          // setSelectedUrl(links[links.length - 1])
          // document.getElementById(`task-${links[links.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  // whenever filteredLinks Update, set current url as first
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
