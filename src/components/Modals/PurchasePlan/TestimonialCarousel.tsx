import React, { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Image from 'next/image';
import '@/styles/embla.css';
import { testimonials } from '@/lib/constants/constants';
import { ChevronLeft, ChevronRight, Quote, Star, Zap } from "lucide-react";




interface TestimonialCarouselProps {
  upgradeMode: boolean;
}

const TestimonialCarousel: React.FC<TestimonialCarouselProps> = ({ upgradeMode }) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    loop: true,
    align: 'center',
    containScroll: 'trimSnaps'
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  const scrollTo = useCallback((index: number) => {
    if (emblaApi) emblaApi.scrollTo(index);
  }, [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
  }, [emblaApi, onSelect]);

  return (
    <div className="md:h-full   md:!bg-black gap-4 w-full md:w-1/2 p-12 flex flex-col justify-around relative">
      {/* Header */}
      <div className="mt-8">
        <p className="text-display text-center text-gray-300">Trusted by teams at</p>
      </div>

      {/* Carousel Container */}
      <div className="relative flex items-center justify-center">
        <div className="embla max-w-4xl w-full" ref={emblaRef}>
          <div className="embla__container flex">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="embla__slide min-h-full max-w-[90vw] md:max-w-[380px] lg:max-w-[500px] flex-[0_0_90%] min-w-0 pl-4 flex">
                <div className=" !border-2 border-border-light-gray-thin rounded-lg shadow-xl p-4 md:p-8 mx-2 flex flex-col w-full">
                  {/* Quote Icon */}
                  <div className="mb-4">
                    <Quote strokeWidth={1.75} className="w-8 h-8 text-blue-400" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 mb-6">
                    <p className="text-gray-200 leading-relaxed font-medium  overflow-hidden">
                      &ldquo;{testimonial.content}&rdquo;
                    </p>
                  </div>

                  {/* Author Info */}
                  <div className="flex items-center gap-4 mt-auto">
                    <div className="relative w-14 h-14 rounded-full overflow-hidden bg-transparent flex-shrink-0">
                      <img
                        src={testimonial.avatar}
                        alt={testimonial.name}
                        // fill
                        className="object-cover"
                        // sizes="56px"
                      />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-white text-subheading">
                        {testimonial.name}
                      </h4>
                      <p className="text-gray-400 text-emphasis">{testimonial.role}</p>
                      <div className="flex gap-1 mt-1">
                        {[...Array(5)].map((_, i) => (
                          <Star size={14} strokeWidth={1.75} key={i} className="text-yellow-400 text-content" />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        
        {/* Navigation Buttons
        <button
          onClick={scrollPrev}
          className="absolute left-4 z-30 p-3 bg-gray-700 hover:bg-gray-600 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
          aria-label="Previous testimonial"
        >
          <ChevronLeft strokeWidth={1.75} className="w-6 h-6 text-white" />
        </button>
        <button
          onClick={scrollNext}
          className="absolute right-4 z-30 p-3 bg-gray-700 hover:bg-gray-600 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
          aria-label="Next testimonial"
        >
          <ChevronRight strokeWidth={1.75} className="w-6 h-6 text-white" />
        </button> */}
      </div>

      {/* Dots Indicator */}
      <div className="flex justify-center gap-2 mt-6">
        {testimonials.map((_, index) => (
          <button
            key={index}
            onClick={() => scrollTo(index)}
            className={` h-2 rounded-full transition-all duration-200 ${
              index === selectedIndex 
                ? "bg-hypertasks-ai-purple w-6 scale-125" 
                : "bg-gray-600 w-3 hover:bg-gray-500"
            }`}
            aria-label={`Go to testimonial ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
};

export default TestimonialCarousel; 
