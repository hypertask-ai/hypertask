import { TeamStartPlanButton } from "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton";
import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import "@/styles/AttachmentView.scss";
import { Carousel, CarouselItem, ModalHeader , ModalBody, ModalFooter } from "reactstrap";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { testimonials } from "@/lib/constants/constants";
import Image from "next/image";
import { ITeam, IUser } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import axios from "axios";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { LogOut, Star } from "lucide-react";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import Tooltip from "@/components/Common/Tooltip";
interface ITrialModal {
  currentUser: IUser | null;
  callback: () => void;
}

const TrialModal: React.FC<ITrialModal> = ({ currentUser, callback }) => {
  const isMbl = useContext(MobileViewContext);
  const [currentProject, _] = useRecoilState(currentProjectAtom);
  const [currTeam, setCurrTeam] = useState<ITeam | undefined>(undefined);
  const { handleHardReset } = useSignout();

  const findTeam = async () => {
    const response = await axios.get(
      `/api/teams/getByUserId?userId=${currentUser?.id}`
    );
    console.log(
      "🚀 ~ findTeam ~ currentProject?.teamId:",
      currentProject?.teamId
    );
    if (response.status === 200) {
      console.log("🚀 ~ findTeam ~ response:", response);
      setCurrTeam(response.data);
    } else {
      console.log("🚀 ~ findTeam ~ response:", response);
    }
  };

  useEffect(() => {
    findTeam();
  }, []);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="trial-modal-v2"
      toggle={() => { }}
      shouldCloseOnClickOutside={false}
      contentClassName="h-full"
      fullScreen={isMbl}
      className="font-bold bg-white-black-inverted sm:max-h-[750px] border-none sm:top-[40px] sm:w-full md:min-w-[900px] flex flex-col"
    >
      <ModalHeader className="rounded-none border-b-0 h-[60px] pl-[24px] text-subheading font-bold [&>*:first-child]:w-full">
        <div className="flex justify-end items-center w-full">
          <div className="w-fit h-fit relative group">
            <LogOut size={18} strokeWidth={1.75}
              onClick={() => {
                callback();
                handleHardReset();
              }}
              className="cursor-pointer "
              width={18}
              height={18}
            />

            <Tooltip
              left={-60}
              bottom={-40}
              text="Sign Out"
              keyCombination={[]}
            />
          </div>
        </div>
      </ModalHeader>
      <div className="max-h-[90vh] scrollbar-thin overflow-y-auto flex flex-col">
        <div className="">
          <ModalBody className="w-full flex items-center justify-center border-b-0 border-transparent pt-0">
            <TeamStartPlanButton teamId={currTeam?.id} />
          </ModalBody>
          <ModalFooter className="w-full items-center justify-center border-t-0 py-0 px-2">
            <TrialFooter />
          </ModalFooter>
        </div>
      </div>
    </ModalContainerCustom>
  );
};

const TrialFooter = () => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [animating, setAnimating] = useState<boolean>(false);
  const isMbl = useContext(MobileViewContext);

  const checkCarousal = useMemo(() => {
    const check = isMbl
      ? testimonials.length - 1
      : Math.floor((testimonials.length - 1) / 2);
    return check;
  }, [isMbl]);
  const pairedSlides = useMemo(() => {
    const slides = [];
    const jump = isMbl ? 1 : 2;
    for (let i = 0; i < testimonials.length; i += jump) {
      const firstTestimonial = testimonials[i];

      if (isMbl) {
        slides.push(
          <CarouselItem
            onExiting={() => setAnimating(true)}
            onExited={() => setAnimating(false)}
            key={i}
            className="min-h-[200px] w-full"
          >
            <TestimonialCard testimonial={firstTestimonial} />
          </CarouselItem>
        );
      } else {
        const secondTestimonial = testimonials[(i + 1) % testimonials.length];
        if (firstTestimonial === secondTestimonial) continue;
        slides.push(
          <CarouselItem
            onExiting={() => setAnimating(true)}
            onExited={() => setAnimating(false)}
            key={i}
            className="min-h-[200px] w-full"
          >
            <CarouselSlide
              firstTestimonial={firstTestimonial}
              secondTestimonial={secondTestimonial}
            />
          </CarouselItem>
        );
      }
    }
    return slides;
  }, [isMbl]);

  const next = () => {
    if (animating) return;
    const nextIndex = activeIndex === checkCarousal ? 0 : activeIndex + 1;
    setActiveIndex(nextIndex);
  };

  const previous = () => {
    if (animating) return;

    const nextIndex = activeIndex === 0 ? checkCarousal : activeIndex - 1;
    setActiveIndex(nextIndex);
  };

  return (
    <div className="flex flex-col w-full sm:px-[50px] md:px-0">
      <Carousel
        id="carousel-trial-testimonials"
        className="h-full w-full"
        activeIndex={activeIndex}
        interval={false}
        next={next}
        enableTouch={true}
        previous={previous}
      >
        {pairedSlides}
      </Carousel>
      <div className="gap-3 pb-2 pt-1 w-full justify-center flex">
        <button
          disabled={activeIndex === 0}
          id="prev"
          onClick={previous}
          className="p-3 rounded-lg bg-[#D9D9D9] hover:bg-gray-300 disabled:bg-[#D9D9D9]/30 disabled:cursor-not-allowed transition-colors"
        >
          <PrevButton />
        </button>
        <button
          id="next"
          disabled={activeIndex === checkCarousal}
          onClick={next}
          className="p-3 rounded-lg bg-[#D9D9D9] hover:bg-gray-300 disabled:bg-[#D9D9D9]/30 disabled:cursor-not-allowed  transition-colors"
        >
          <Next />
        </button>
      </div>
    </div>
  );
};

const Next = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 64 64"
      fill="none"
    >
      <path
        fillRule="evenodd"
        d="M18.584 6.584C18.7698 6.39775 18.9905 6.24998 19.2335 6.14915C19.4765 6.04833 19.737 5.99643 20 5.99643C20.2631 5.99643 20.5236 6.04833 20.7666 6.14915C21.0096 6.24998 21.2303 6.39775 21.416 6.584L45.416 30.584C45.6023 30.7698 45.7501 30.9905 45.8509 31.2335C45.9517 31.4765 46.0036 31.7369 46.0036 32C46.0036 32.2631 45.9517 32.5236 45.8509 32.7665C45.7501 33.0095 45.6023 33.2302 45.416 33.416L21.416 57.416C21.0405 57.7915 20.5311 58.0025 20 58.0025C19.4689 58.0025 18.9596 57.7915 18.584 57.416C18.2085 57.0405 17.9975 56.5311 17.9975 56C17.9975 55.4689 18.2085 54.9595 18.584 54.584L41.172 32L18.584 9.41601C18.3978 9.23022 18.25 9.00952 18.1492 8.76654C18.0484 8.52356 17.9965 8.26307 17.9965 8C17.9965 7.73694 18.0484 7.47645 18.1492 7.23347C18.25 6.99049 18.3978 6.76979 18.584 6.584Z"
        fill="black"
      />
    </svg>
  );
};

const PrevButton = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 64 64"
      fill="none"
    >
      <g transform="rotate(180, 32, 32)">
        <path
          fillRule="evenodd"
          d="M18.584 6.584C18.7698 6.39775 18.9905 6.24998 19.2335 6.14915C19.4765 6.04833 19.737 5.99643 20 5.99643C20.2631 5.99643 20.5236 6.04833 20.7666 6.14915C21.0096 6.24998 21.2303 6.39775 21.416 6.584L45.416 30.584C45.6023 30.7698 45.7501 30.9905 45.8509 31.2335C45.9517 31.4765 46.0036 31.7369 46.0036 32C46.0036 32.2631 45.9517 32.5236 45.8509 32.7665C45.7501 33.0095 45.6023 33.2302 45.416 33.416L21.416 57.416C21.0405 57.7915 20.5311 58.0025 20 58.0025C19.4689 58.0025 18.9596 57.7915 18.584 57.416C18.2085 57.0405 17.9975 56.5311 17.9975 56C17.9975 55.4689 18.2085 54.9595 18.584 54.584L41.172 32L18.584 9.41601C18.3978 9.23022 18.25 9.00952 18.1492 8.76654C18.0484 8.52356 17.9965 8.26307 17.9965 8C17.9965 7.73694 18.0484 7.47645 18.1492 7.23347C18.25 6.99049 18.3978 6.76979 18.584 6.584Z"
          fill="black"
        />
      </g>
    </svg>
  );
};

interface TestimonialCardProps {
  testimonial: {
    name: string;
    role: string;
    content: string;
    avatar: string;
  };
}


const TestimonialCard = ({ testimonial }: TestimonialCardProps) => {
  const isMbl = useContext(MobileViewContext);

  return (
    <div
      className={`${isMbl ? "w-full mx-auto" : "w-[50%]"
        } border-text-light-gray border-2 p-3 rounded-md`}
    >
      <div className="flex flex-col h-fit items-center border-black">
        <div className="flex justify-start items-start w-full gap-4">
          <div
            className="relative aspect-square rounded-full bg-gray-300/50"
            style={{ width: 50, height: 50 }}
          >
            <Image
              src={testimonial.avatar}
              alt={"php-testimonial"}
              fill
              className="rounded-full object-cover"
              sizes={`${50}px`}
            />
          </div>
          <div className="flex flex-col gap-1 mb-2">
            <h2 className="font-bold">{testimonial.name}</h2>
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star strokeWidth={1.75} size={14} key={index} className="text-orange-400" />
              ))}
            </div>
            <p className="text-content font-normal">{testimonial.role}</p>
          </div>
        </div>
      </div>
      <div className="font-normal w-full">{testimonial.content}</div>
    </div>
  );
};

const CarouselSlide = ({ firstTestimonial, secondTestimonial }: any) => {
  return (
    <div className="flex gap-2">
      <TestimonialCard testimonial={firstTestimonial} />
      <TestimonialCard testimonial={secondTestimonial} />{" "}
    </div>
  );
};

export default TrialModal;
